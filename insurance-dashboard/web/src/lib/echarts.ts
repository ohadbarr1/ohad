/** The chart library, registered once. Imported dynamically by Chart.tsx, so a page loads it only when it draws its first chart. */
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { MarkAreaComponent } from 'echarts/components';  // F2 TIME: the quartile bands of the percentile charts
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, ScatterChart, TitleComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);
echarts.use([MarkAreaComponent]);
echarts.use([SVGRenderer]);  // W8: the SVG export (Chart.tsx draws on canvas; a copy is rendered to an SVG string for the file)
export { echarts };
