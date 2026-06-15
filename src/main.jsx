import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installStorageAdapter } from "./storage/adapter";
import App from "./App";
import "./index.css";

// 프로그램이 마운트되기 전에 전역 window.storage 를 주입해야 한다.
installStorageAdapter();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
