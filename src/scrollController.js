import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

export class ScrollController {
    constructor(settings, appDisplay, workspacesDisplay, onAppGridPage) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._workspacesDisplay = workspacesDisplay;
        this._onAppGridPage = onAppGridPage;
        this._lastScrollTime = 0;
        this._appCapturedId = 0;
        this._wsCapturedId = 0;
    }

    enable() {
        if (this._appDisplay) {
            this._appCapturedId = this._appDisplay.connect(
                "captured-event",
                (actor, event) => {
                    if (event.type() !== Clutter.EventType.SCROLL)
                        return Clutter.EVENT_PROPAGATE;
                    if (this._appDisplay._folderOpen)
                        return Clutter.EVENT_PROPAGATE;
                    return this._processScroll(event, "app-grid")
                        ? Clutter.EVENT_STOP
                        : Clutter.EVENT_PROPAGATE;
                },
            );
        }

        if (this._workspacesDisplay) {
            this._wsCapturedId = this._workspacesDisplay.connect(
                "captured-event",
                (actor, event) => {
                    if (event.type() !== Clutter.EventType.SCROLL)
                        return Clutter.EVENT_PROPAGATE;
                    return this._processScroll(event, "workspaces")
                        ? Clutter.EVENT_STOP
                        : Clutter.EVENT_PROPAGATE;
                },
            );
        }
    }

    disable() {
        if (this._appCapturedId && this._appDisplay) {
            this._appDisplay.disconnect(this._appCapturedId);
            this._appCapturedId = 0;
        }
        if (this._wsCapturedId && this._workspacesDisplay) {
            this._workspacesDisplay.disconnect(this._wsCapturedId);
            this._wsCapturedId = 0;
        }
    }

    _processScroll(event, type) {
        const direction = this._settings.get_string(type + "-scroll-direction");
        if (direction === "default") return false;

        const step = this._getScrollStep(event, direction);
        if (step === 0) return false;

        const now = GLib.get_monotonic_time();
        if (now - this._lastScrollTime < 250000) return true;
        this._lastScrollTime = now;

        if (type === "app-grid") this._onAppGridPage(step);
        else this._switchWorkspace(step);
        return true;
    }

    _getScrollStep(event, mode) {
        const scrollDirection = event.get_scroll_direction();
        if (scrollDirection !== Clutter.ScrollDirection.SMOOTH) {
            if (mode === "vertical") {
                if (scrollDirection === Clutter.ScrollDirection.UP) return -1;
                if (scrollDirection === Clutter.ScrollDirection.DOWN) return 1;
                return 0;
            }
            if (scrollDirection === Clutter.ScrollDirection.LEFT) return -1;
            if (scrollDirection === Clutter.ScrollDirection.RIGHT) return 1;
            if (scrollDirection === Clutter.ScrollDirection.UP) return -1;
            if (scrollDirection === Clutter.ScrollDirection.DOWN) return 1;
            return 0;
        }

        const [dx, dy] = event.get_scroll_delta();
        if (dx === 0 && dy === 0) return 0;
        if (mode === "vertical") {
            if (Math.abs(dx) > Math.abs(dy)) return 0;
            return dy > 0 ? 1 : -1;
        }

        const dominantDelta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        if (dominantDelta === 0) return 0;
        return dominantDelta > 0 ? 1 : -1;
    }

    _switchWorkspace(step) {
        const workspaceManager = global.workspace_manager;
        const activeIndex = workspaceManager.get_active_workspace_index();
        const nWorkspaces = workspaceManager.get_n_workspaces();
        const newIndex = Math.min(
            Math.max(activeIndex + step, 0),
            nWorkspaces - 1,
        );
        if (newIndex !== activeIndex) {
            workspaceManager
                .get_workspace_by_index(newIndex)
                .activate(global.get_current_time());
        }
    }
}
