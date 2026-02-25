// Copyright (c) 2026 Randall Rosas (Slategray). All rights reserved.

/**
 * Initialize React application root.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
