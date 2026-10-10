import {Prisma} from '@prisma/client';
import {requireActorRoles,type DomainActor} from '@/server/actor';
import {FINANCE_ROLES} from '@/lib/roles';
import {readCashBalance,readOrgBalance} from '@/server/payroll/cash-core';
export async function deletePaymentInTransaction(actor:DomainActor,paymentId:string,previewDirection:string,payrollCurrency:string,payrollRate:string,tx:Prisma.TransactionClient){
requireActorRoles(actor,FINANCE_ROLES);
      const current = await tx.payment.findUnique({ where: { id: paymentId }, include: { project: { select: { id: true, number: true, deletedAt: true } }, stockPurchase: { select: { id: true } } } });
      if (!current || current.deletionId) throw new Error("Платёж не найден или уже удалён");
      if (current.logisticsAllocationId) throw new Error("Расход связан с рейсом — исправьте общий рейс в логистике");
      if (current.stockPurchase) throw new Error("Платёж связан с приходом на склад — отдельно удалить его нельзя");
      if (current.project?.deletedAt) throw new Error("Проект в корзине: финансовая история доступна только для просмотра");
      if (current.direction === "INCOME") {
        if (previewDirection !== current.direction) throw new Error("Платёж изменился — повторите операцию");
        const setting = await tx.orgSetting.findUnique({ where: { key: "payrollCurrency" } });
        if ((setting?.value ?? "BYN") !== payrollCurrency) throw new Error("Валюта зарплаты изменилась — повторите операцию");
        if (current.cashAccountId) {
          const cashBalance = await readCashBalance(tx, current.cashAccountId);
          if (cashBalance.sub(current.amount).lt(0)) throw new Error("Удаление прихода сделает остаток кассы отрицательным");
        }
        const orgBalanceAfter = await readOrgBalance(tx, payrollRate, `-${current.bynAmount.toFixed(2)}`);
        if (orgBalanceAfter.lt(0)) throw new Error("Удаление прихода сделает баланс организации отрицательным");
      }
      await tx.payment.delete({ where: { id: paymentId } });
      await tx.changeLog.create({ data: { actorType: "user", actorId: actor.id, actorName: actor.name ?? undefined,
        entity: "payment", entityId: paymentId, action: "delete", oldValue: { project: current.project?.number ?? null,
          direction: current.direction, amount: current.amount.toFixed(2), currency: current.currency,
          bynAmount: current.bynAmount.toFixed(2) } } });
      return current;
}
