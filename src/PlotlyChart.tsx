import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";

// Factory pattern (not the default react-plotly.js export) so the bundle
// only pulls in plotly.js-dist-min instead of the full plotly.js package.
const Plot = createPlotlyComponent(Plotly);

export default Plot;

/** Plotly itself, for things like saving a plot as an image. */
export { Plotly };
