import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PayrollSettingsForm() {
  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="text-2xl font-semibold">Зарплата</h1><p className="text-sm text-muted-foreground">Общие параметры начислений и расчётников</p></div>
      <Card className="max-w-xl">
        <CardHeader><CardTitle className="text-lg">Валюта зарплаты</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="font-medium">BYN — белорусский рубль</p>
          <p className="text-xs text-muted-foreground">Новые начисления и внутренние расчёты ведутся в BYN. Исторические записи сохраняют исходную валюту; валюта физической кассы выбирается при выплате.</p>
        </CardContent>
      </Card>
    </div>
  );
}
