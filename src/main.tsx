import { render } from "@solidjs/web";
import { applyDensity, applyLang, applyTheme } from "@hostry/ui-kit";
import "@hostry/ui-kit/styles.css";
import "./app.css";
import { App } from "./App";
import { createAppTranslator } from "./i18n";
import { createAdminRouter } from "./router";
import { createSessionState } from "./session/session";

// Vendor admin: desktop density, light theme (dark follows the OS), English only in A0.
applyDensity("desktop");
applyTheme("system");
applyLang("en");

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

// No session is created here: App asks the admin backend (same-origin cookie) whether one exists.
render(() => <App router={createAdminRouter()} session={createSessionState()} translator={createAppTranslator()} />, root);
