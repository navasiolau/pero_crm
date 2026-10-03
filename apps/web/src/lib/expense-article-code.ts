export const MAX_EXPENSE_ARTICLE_CODE=2_147_483_647;
export function parseExpenseArticleCode(value:string):number{
 if(!/^[0-9]+$/.test(value))throw Error('Код статьи должен содержать только цифры');
 const code=Number(value);if(!Number.isSafeInteger(code)||code<1||code>MAX_EXPENSE_ARTICLE_CODE)throw Error('Код статьи — целое число от 1 до 2147483647');return code;
}
export function nextExpenseArticleCode(max:number|null):number{
 const next=(max??0)+1;if(next>MAX_EXPENSE_ARTICLE_CODE)throw Error('Автоматические коды закончились. Укажите свободный положительный код');return next;
}
