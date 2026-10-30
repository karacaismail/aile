export const financeSchemaVersion = 'finance-v1';
export const financeRanges = { metadata: 'A1:A9', monthly: 'A11:I37', daily: 'A43:R6000' } as const;
export const monthlyHeaders = ['Ay', 'Nakit', 'KMH anapara', 'KMH faiz + vergi', 'Kart borcu', 'Gelecek taksit', 'Birikimde kalan', 'Net nakit ve borç', 'Fon eksiği'] as const;
export const dailyHeaders = ['Tarih', 'Adım', 'Tür', 'Nakit değişimi', 'Gerekli bakiye', 'Harcanabilir nakit', 'KMH anapara', 'KMH faiz + vergi', 'Denizbank anapara', 'Denizbank faiz + vergi', 'İşbank anapara', 'İşbank faiz + vergi', 'Gelecek taksit taahhüdü', 'Toplam kart borcu', 'Fon eksiği', 'Kesinlik', 'Kaynak', 'ID'] as const;
