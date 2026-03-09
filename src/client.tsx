// Entry point — just mounts the React app into #root
// Keeping this dead simple, all the real stuff is in app.tsx

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element in index.html");

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
