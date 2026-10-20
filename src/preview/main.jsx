import React from "react";
import { createRoot } from "react-dom/client";
import { RecapPreview } from "./RecapPreview.jsx";
import "../styles/global.css";
import "./recap.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RecapPreview />
  </React.StrictMode>
);
