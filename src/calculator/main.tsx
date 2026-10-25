/** MatrixLab Calculator — the smart calculator (Calculate · Work · Graph)
 * as its own app, themed. Same blocks and engine as the canvas app. */
import React from "react";
import ReactDOM from "react-dom/client";
import "../App.css";
import "./calculator.css";
import CalculatorApp from "./CalculatorApp";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CalculatorApp />
  </React.StrictMode>,
);
