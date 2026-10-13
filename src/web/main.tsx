import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDronesStore } from "./service/drones-store";
import { DronesContext } from "./service/use-drones";
import { App } from "./app";
import { ErrorBoundary } from "./components/error-boundary";
import { readPageOptions } from "./routes";
import "./styles/tokens.css";
import "./styles/base.css";

const options = readPageOptions(location.search);
// The colour scheme is applied in index.html before the first paint.
if (options.kiosk) document.documentElement.dataset["kiosk"] = "";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <DronesContext value={createDronesStore()}>
        <App options={options} />
      </DronesContext>
    </ErrorBoundary>
  </StrictMode>,
);
