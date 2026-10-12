import { payrollMonth } from "@/lib/payroll-month";
import { Prisma, type ProductPercentageKind, type ProductStatus } from '@prisma/client';
import { assertProjectMoneyCurrency } from "@/lib/internal-currency";
import type { DomainActor } from '@/server/projects/core';
import { PERCENTAGE_STAGE_POLICY } from './stage-policy';
import { calculateWholeProductPercentage } from '@/lib/product-percentage-ceil';
import { parseProductPercentageRate } from '@/lib/product-percentage-rate-limit';
import { NO_ASSIGNEE_COMPLETION_REASON, isPermanentUnassignedCompletion } from './skip-reason';
export type PercentageAccrualEffects = {
    eventIds: string[];
    earnings: {
        userId: string;
        userName: string;
        amount: string;
        currency: string;
    }[];
};
export async function captureDirectPercentage(tx: Prisma.TransactionClient, actor: DomainActor, productId: string, kind: ProductPercentageKind, statusAtCompletion: ProductStatus, effects?: PercentageAccrualEffects) {
    const product = await tx.product.findUnique({
        where: {
            id: productId
        },
        include: {
            project: {
                select: {
                    currency: true
                }
            },
            engineer: {
                select: {
                    id: true,
                    name: true,
                    active: true,
                    roles: true
                }
            },
            mounter: {
                select: {
                    id: true,
                    name: true,
                    active: true,
                    roles: true
                }
            },
            assembler: {
                select: {
                    id: true,
                    name: true,
                    active: true,
                    roles: true
                }
            },
            percentageConfigs: {
                where: {
                    kind
                }
            },
            stagePayPools: {
                where: {
                    kind: 'ENGINEERING'
                },
                select: {
                    state: true
                }
            }
        }
    });
    if (!product)
        throw new Error('Изделие не найдено');
    const config = product.percentageConfigs.at(0);
    const rate = config?.ratePercent == null
        ? null
        : new Prisma.Decimal(config.ratePercent.toString());
    const price = product.expectedPrice == null
        ? null
        : new Prisma.Decimal(product.expectedPrice.toString());
    if (!Number.isSafeInteger(product.quantity) || product.quantity < 1)
        throw new Error('Количество изделия должно быть положительным целым');
    if (price && (!price.isFinite() || price.isNegative()))
        throw new Error('Цена изделия должна быть неотрицательной');
    if (rate && (!rate.isFinite() || rate.isNegative() || rate.gt(100)))
        throw new Error('Ставка должна быть от 0 до 100 процентов');
    assertProjectMoneyCurrency(product.project.currency);
    const policy = PERCENTAGE_STAGE_POLICY[kind];
    const recipient = product[policy.recipient];
    const eligible = !!recipient?.active && recipient.roles.includes(policy.role);
    const positive = rate !== null && rate.gt(0);
    const protectedReason: string | null = kind === 'ENGINEERING' && product.stagePayPools.some(pool => pool.state === 'SETTLED' || pool.state === 'LEGACY_PROTECTED')
        ? 'Уже защищено прежним способом оплаты'
        : null;
    const noAssignee = !protectedReason && recipient == null;
    if (positive && !protectedReason && !noAssignee)
        parseProductPercentageRate(rate!.toString());
    if (positive && !protectedReason && !noAssignee && price === null)
        throw new Error('Для положительной ставки укажите цену изделия');
    if (positive && !protectedReason && !noAssignee && !eligible)
        throw new Error(policy.recipientError);
    const total = price?.mul(product.quantity) ?? null;
    if (total?.gt('9999999999999999.99'))
        throw new Error('Сумма процентного этапа превышает допустимую');
    const calculated = noAssignee
        ? null
        : calculateWholeProductPercentage({
            kind,
            unitPrice: price?.toString() ?? null,
            quantity: product.quantity,
            rate: rate?.toString() ?? null
        });
    const exact = calculated
        ? new Prisma.Decimal(calculated.sourceFundExact)
        : null;
    const state = protectedReason
        ? 'LEGACY_PROTECTED'
        : noAssignee || rate === null
            ? 'SKIPPED_ONCE'
            : 'SETTLED';
    const amount = state === 'SETTLED'
        ? calculated!.amount
        : null;
    const now = new Date();
    const recipientSnapshot = eligible
        ? recipient!
        : null;
    const completion = await tx.productPercentageCompletion.create({
        data: {
            productId,
            kind,
            state,
            statusAtCompletion,
            calculationVersion: 4,
            quantitySnapshot: product.quantity,
            totalSnapshot: total,
            recipientId: recipientSnapshot?.id ?? null,
            completedAt: now,
            completedById: actor.id,
            reason: protectedReason ?? (noAssignee
                ? NO_ASSIGNEE_COMPLETION_REASON
                : rate === null
                    ? 'Ставка не задана при первом завершении'
                    : null),
            priceSnapshot: price,
            ratePercentSnapshot: noAssignee
                ? null
                : rate,
            productCurrency: 'BYN',
            payrollCurrency: 'BYN',
            configRevision: config?.revision ?? null,
            ...(state === 'SETTLED'
                ? {
                    productRateByn: 1,
                    payrollRateByn: 1,
                    productRateDate: now,
                    payrollRateDate: now,
                    sourceFundExact: exact,
                    amount,
                    bynAmount: amount,
                    projectAmount: amount,
                    settledAt: now
                }
                : {})
        }
    });
    if (recipientSnapshot) {
        const share = await tx.productPercentageCompletionShare.create({
            data: {
                completionId: completion.id,
                userId: recipientSnapshot.id,
                userNameSnapshot: recipientSnapshot.name,
                shareUnits: 1000000,
                ...(amount !== null
                    ? {
                        amount,
                        bynAmount: amount,
                        projectAmount: amount
                    }
                    : {})
            }
        });
        if (amount !== null && new Prisma.Decimal(amount).gt(0)) {
            await tx.payrollEntry.create({
                data: {
                    userId: recipientSnapshot.id,
                    productId,
                    projectId: product.projectId,
                    percentageCompletionShareId: share.id,
                    amount,
                    bynAmount: amount,
                    projectAmount: amount,
                    projectCurrency: 'BYN',
                    currency: 'BYN',
                    scheme: policy.scheme,
                    month: payrollMonth(now),
                    comment: `${policy.label} изделия ${product.number}`
                }
            });
            const event = await tx.domainEvent.create({
                data: {
                    type: 'payroll.accrued',
                    actor: actor.id,
                    payload: {
                        userId: recipientSnapshot.id,
                        productId,
                        projectId: product.projectId,
                        kind,
                        amount: Number(amount)
                    }
                }
            });
            effects?.eventIds.push(event.id);
            effects?.earnings.push({
                userId: recipientSnapshot.id,
                userName: recipientSnapshot.name,
                amount,
                currency: 'BYN'
            });
        }
    }
    await tx.changeLog.create({
        data: {
            actorType: 'user',
            actorId: actor.id,
            actorName: actor.name,
            source: actor.source,
            entity: 'product',
            entityId: productId,
            action: 'percentage.firstCompletion',
            newValue: {
                kind,
                state,
                completionId: completion.id,
                statusAtCompletion,
                calculationVersion: 4
            }
        }
    });
    return state;
}
/** Добирание пропущенного начисления: ставка задана позже, следующий переход этапа доначисляет.
 * Обновляет существующее SKIPPED-завершение вместо создания (уникальность productId+kind). */
export async function settleSkippedPercentage(tx: Prisma.TransactionClient, actor: DomainActor, productId: string, kind: ProductPercentageKind, statusAtCompletion: ProductStatus, effects?: PercentageAccrualEffects) {
    const product = await tx.product.findUnique({
        where: {
            id: productId
        },
        include: {
            project: {
                select: {
                    id: true,
                    number: true,
                    currency: true
                }
            },
            engineer: {
                select: {
                    id: true,
                    name: true,
                    active: true,
                    roles: true
                }
            },
            mounter: {
                select: {
                    id: true,
                    name: true,
                    active: true,
                    roles: true
                }
            },
            assembler: {
                select: {
                    id: true,
                    name: true,
                    active: true,
                    roles: true
                }
            },
            percentageConfigs: {
                where: {
                    kind
                }
            },
            stagePayPools: {
                where: {
                    kind: 'ENGINEERING'
                },
                select: {
                    state: true
                }
            }
        }
    });
    if (!product)
        throw new Error('Изделие не найдено');
    const completion = await tx.productPercentageCompletion.findUnique({
        where: {
            productId_kind: {
                productId,
                kind
            }
        },
        include: {
            shares: true
        }
    });
    if (!completion || completion.state !== 'SKIPPED_ONCE')
        return completion?.state ?? 'SKIPPED_ONCE';
    if (isPermanentUnassignedCompletion(completion))
        return 'SKIPPED_ONCE';
    const policy = PERCENTAGE_STAGE_POLICY[kind];
    const protectedReason: string | null = kind === 'ENGINEERING' && product.stagePayPools.some(pool => pool.state === 'SETTLED' || pool.state === 'LEGACY_PROTECTED')
        ? 'Уже защищено прежним способом оплаты'
        : null;
    if (protectedReason) {
        await tx.productPercentageCompletion.update({
            where: {
                id: completion.id
            },
            data: {
                state: 'LEGACY_PROTECTED',
                reason: protectedReason
            }
        });
        return 'LEGACY_PROTECTED';
    }
    const config = product.percentageConfigs.at(0);
    const rate = config?.ratePercent == null
        ? null
        : new Prisma.Decimal(config.ratePercent.toString());
    const price = product.expectedPrice == null
        ? null
        : new Prisma.Decimal(product.expectedPrice.toString());
    const positive = rate !== null && rate.gt(0);
    if (!positive)
        return 'SKIPPED_ONCE';
    if (!Number.isSafeInteger(product.quantity) || product.quantity < 1)
        throw new Error('Количество изделия должно быть положительным целым');
    if (price && (!price.isFinite() || price.isNegative()))
        throw new Error('Цена изделия должна быть неотрицательной');
    if (rate.gt(100))
        throw new Error('Ставка должна быть от 0 до 100 процентов');
    parseProductPercentageRate(rate.toString());
    assertProjectMoneyCurrency(product.project.currency);
    const recipient = product[policy.recipient];
    const eligible = !!recipient?.active && recipient.roles.includes(policy.role);
    // Исторический пропуск ставки сохраняется без начисления до появления получателя.
    if (recipient == null)
        return 'SKIPPED_ONCE';
    if (price === null)
        throw new Error('Для положительной ставки укажите цену изделия');
    if (!eligible)
        throw new Error(policy.recipientError);
    const total = price?.mul(product.quantity) ?? null;
    if (total?.gt('9999999999999999.99'))
        throw new Error('Сумма процентного этапа превышает допустимую');
    const calculated = calculateWholeProductPercentage({
        kind,
        unitPrice: price?.toString() ?? null,
        quantity: product.quantity,
        rate: rate?.toString() ?? null
    });
    const exact = calculated
        ? new Prisma.Decimal(calculated.sourceFundExact)
        : null;
    const amount = calculated!.amount;
    const now = new Date();
    const recipientSnapshot = eligible
        ? recipient!
        : null;
    await tx.productPercentageCompletion.update({
        where: {
            id: completion.id
        },
        data: {
            state: 'SETTLED',
            statusAtCompletion,
            calculationVersion: 4,
            quantitySnapshot: product.quantity,
            totalSnapshot: total,
            recipientId: recipientSnapshot?.id ?? null,
            completedAt: now,
            completedById: actor.id,
            reason: null,
            priceSnapshot: price,
            ratePercentSnapshot: rate,
            productCurrency: 'BYN',
            payrollCurrency: 'BYN',
            configRevision: config?.revision ?? null,
            productRateByn: 1,
            payrollRateByn: 1,
            productRateDate: now,
            payrollRateDate: now,
            sourceFundExact: exact,
            amount,
            bynAmount: amount,
            projectAmount: amount,
            settledAt: now
        }
    });
    if (recipientSnapshot) {
        let share = (completion.shares ?? []).at(0);
        share = share
            ? await tx.productPercentageCompletionShare.update({
                where: {
                    id: share.id
                },
                data: {
                    userId: recipientSnapshot.id,
                    userNameSnapshot: recipientSnapshot.name,
                    shareUnits: 1000000,
                    amount,
                    bynAmount: amount,
                    projectAmount: amount
                }
            })
            : await tx.productPercentageCompletionShare.create({
                data: {
                    completionId: completion.id,
                    userId: recipientSnapshot.id,
                    userNameSnapshot: recipientSnapshot.name,
                    shareUnits: 1000000,
                    amount,
                    bynAmount: amount,
                    projectAmount: amount
                }
            });
        if (new Prisma.Decimal(amount).gt(0)) {
            await tx.payrollEntry.create({
                data: {
                    userId: recipientSnapshot.id,
                    productId,
                    projectId: product.project.id,
                    percentageCompletionShareId: share.id,
                    amount,
                    bynAmount: amount,
                    projectAmount: amount,
                    projectCurrency: 'BYN',
                    currency: 'BYN',
                    scheme: policy.scheme,
                    month: payrollMonth(now),
                    comment: `${policy.label} изделия ${product.number}`
                }
            });
            const event = await tx.domainEvent.create({
                data: {
                    type: 'payroll.accrued',
                    actor: actor.id,
                    payload: {
                        userId: recipientSnapshot.id,
                        productId,
                        projectId: product.project.id,
                        kind,
                        amount: Number(amount)
                    }
                }
            });
            effects?.eventIds.push(event.id);
            effects?.earnings.push({
                userId: recipientSnapshot.id,
                userName: recipientSnapshot.name,
                amount,
                currency: 'BYN'
            });
        }
    }
    await tx.changeLog.create({
        data: {
            actorType: 'user',
            actorId: actor.id,
            actorName: actor.name,
            source: actor.source,
            entity: 'product',
            entityId: productId,
            action: 'percentage.lateSettlement',
            newValue: {
                kind,
                completionId: completion.id,
                statusAtCompletion,
                calculationVersion: 4
            }
        }
    });
    return 'SETTLED';
}
/** Новая ставка добавляет корректировку текущим месяцем; исходный снимок неизменен. */
export type PercentageAdjustmentNotice = {
    userId: string;
    label: string;
    number: string;
    oldAmount: string;
    newAmount: string;
    delta: string;
};
export async function adjustSettledPercentage(tx: Prisma.TransactionClient, actor: DomainActor, productId: string, kind: ProductPercentageKind, newRate: string, clientMutationId: string): Promise<{
    adjusted: boolean;
    delta: string;
    notice?: PercentageAdjustmentNotice;
}> {
    const product = await tx.product.findUnique({
        where: {
            id: productId
        },
        include: {
            project: {
                select: {
                    id: true,
                    number: true,
                    currency: true
                }
            }
        }
    });
    if (!product)
        throw new Error('Изделие не найдено');
    if (product.status === 'DONE')
        throw new Error('Изделие завершено: изменение процентов закрыто');
    const completion = await tx.productPercentageCompletion.findUnique({
        where: {
            productId_kind: {
                productId,
                kind
            }
        },
        include: {
            shares: true
        }
    });
    if (!completion || completion.state !== 'SETTLED')
        return {
            adjusted: false,
            delta: '0.00'
        };
    const rate = parseProductPercentageRate(newRate);
    if (rate === null)
        throw new Error('Укажите процент (0 — без оплаты)');
    assertProjectMoneyCurrency(product.project.currency);
    if (product.expectedPrice === null || !Number.isSafeInteger(product.quantity) || product.quantity < 1)
        throw new Error('Для перерасчёта нужны цена и количество изделия');
    const calculated = calculateWholeProductPercentage({
        kind,
        unitPrice: product.expectedPrice.toString(),
        quantity: product.quantity,
        rate
    });
    const newAmount = calculated?.amount ?? null;
    if (newAmount === null)
        throw new Error('Не удалось пересчитать сумму этапа');
    const policy = PERCENTAGE_STAGE_POLICY[kind];
    let share = completion.shares.at(0);
    if (!share && completion.amount?.isZero()) {
        const recipientId = product[policy.assignment];
        const recipient = recipientId
            ? await tx.user.findUnique({
                where: {
                    id: recipientId
                },
                select: {
                    id: true,
                    name: true,
                    active: true,
                    roles: true
                }
            })
            : null;
        if (!recipient?.active || !recipient.roles.includes(policy.role))
            throw new Error(policy.recipientError);
        // Нулевое исходное начисление без получателя допускает добавление его первой нулевой доли.
        share = await tx.productPercentageCompletionShare.create({
            data: {
                completionId: completion.id,
                userId: recipient.id,
                userNameSnapshot: recipient.name,
                shareUnits: 1000000,
                amount: "0.00",
                bynAmount: "0.00",
                projectAmount: "0.00"
            }
        });
    }
    if (!share)
        throw new Error('Доля завершённого этапа не найдена');
    if (completion.shares.length > 1)
        throw new Error('Историческое начисление с несколькими долями защищено');
    const latest = await tx.productPercentageAdjustment.findFirst({
        where: {
            completionShareId: share.id
        },
        orderBy: {
            configRevision: 'desc'
        }
    });
    const oldAmount = latest?.amount.toString() ?? share.amount?.toString() ?? completion.amount?.toString() ?? '0.00';
    const config = await tx.productPercentageConfig.findUnique({
        where: {
            productId_kind: {
                productId,
                kind
            }
        },
        select: {
            revision: true
        }
    });
    const now = new Date();
    const delta = new Prisma.Decimal(newAmount).minus(oldAmount).toFixed(2);
    const adjustment = await tx.productPercentageAdjustment.create({
        data: {
            completionShareId: share.id,
            recipientId: share.userId,
            actorId: actor.id,
            clientMutationId,
            configRevision: config!.revision,
            kind,
            unitPrice: product.expectedPrice,
            quantity: product.quantity,
            ratePercent: rate,
            previousAmount: oldAmount,
            amount: newAmount,
            delta,
            calculationVersion: 4
        }
    });
    if (delta !== '0.00') {
        await tx.payrollEntry.create({
            data: {
                userId: share.userId,
                productId,
                projectId: product.project.id,
                percentageAdjustmentId: adjustment.id,
                amount: delta,
                bynAmount: delta,
                projectAmount: delta,
                projectCurrency: 'BYN',
                currency: 'BYN',
                scheme: policy.scheme,
                month: payrollMonth(now),
                comment: `Корректировка ${policy.label} изделия ${product.number} (было ${oldAmount} → стало ${newAmount})`
            }
        });
    }
    await tx.changeLog.create({
        data: {
            actorType: 'user',
            actorId: actor.id,
            actorName: actor.name,
            source: actor.source,
            entity: 'product',
            entityId: productId,
            action: 'percentage.rateAdjust',
            newValue: {
                kind,
                oldRate: completion.ratePercentSnapshot?.toString() ?? null,
                newRate: rate,
                oldAmount,
                newAmount,
                delta
            }
        }
    });
    return {
        adjusted: true,
        delta,
        ...(delta !== '0.00'
            ? {
                notice: {
                    userId: share.userId,
                    label: policy.label,
                    number: product.number,
                    oldAmount,
                    newAmount,
                    delta
                }
            }
            : {})
    };
}
