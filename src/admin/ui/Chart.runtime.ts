import { init, registerTheme, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Chart'ın tek tembel ECharts çalışma zamanı. Yalnız Chart.tsx bunu import('./Chart.runtime') ile, gerektiğinde yükler:
// telefonda kullanıcı "Grafiği göster" deyince, genişte grafik görünür alana girince. Telefon statik kapanışına girmez
// (scripts/check-delivery.mjs: echarts sınıfı yasak).
// Adlandırılmış importlar ağaç sarsmayı mümkün kılar: 'echarts/charts' ve 'echarts/components' barrel'larının tamamı
// (tüm grafik türleri ve bileşenler) yerine yalnız Bar/Line, Grid/Tooltip/Legend ve Canvas çizici pakete girer.
// Bilinçli olarak *.wide değildir: wide grubu tek parçadır ve antd'yi statik çeker; telefonda kullanıcı başlatmalı
// yükleme o parçayı (ve antd'yi) indirmemeli, geniş sayfalar da grafik yokken ECharts indirmemeli.
use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export { init, registerTheme };
