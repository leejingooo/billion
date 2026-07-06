import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installStorageAdapter } from "./storage/adapter";
import Root from "./Root";
import "./index.css";

// 프로그램이 마운트되기 전에 전역 window.storage 를 주입해야 한다.
// (window.storage 는 호출 시점에 backend.getDriver() 를 참조하므로,
//  서버 백엔드 hydrate 완료 후 프로그램이 마운트되면 캐시를 읽는다 — Root 가 순서 보장.)
installStorageAdapter();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
