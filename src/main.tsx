import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LocalFarmPage from "./pages/farmer/LocalFarmPage";
import "./local-farm.css";
import { registerPwa } from "./lib/pwa";

registerPwa();
createRoot(document.getElementById("root")!).render(<StrictMode><LocalFarmPage /></StrictMode>);
