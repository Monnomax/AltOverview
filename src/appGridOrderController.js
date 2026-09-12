import GLib from "gi://GLib";
import Shell from "gi://Shell";

const ORDER_MODES = [
    "manual",
    "name-ascending",
    "name-descending",
    "usage",
    "last-used",
];

export class AppGridOrderController {
    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._appSystem = Shell.AppSystem.get_default();
        this._originalCompareItems = null;
        this._settingsChangedId = 0;
        this._appStateChangedId = 0;
    }

    enable() {
        const appDisplay = this._appDisplay;
        const appSystem = this._appSystem;
        if (
            !appDisplay ||
            !appSystem ||
            typeof appDisplay._compareItems !== "function"
        )
            return;

        this._originalCompareItems = appDisplay._compareItems;
        const controller = this;

        appDisplay._compareItems = function (left, right) {
            if (controller._getOrderMode() === "manual")
                return controller._originalCompareItems.call(this, left, right);

            return controller._compareOrderedItems(left, right);
        };

        this._settingsChangedId = this._settings.connect(
            "changed::app-grid-order",
            () => appDisplay._redisplay?.(),
        );

        const appSystemChanged = (system, app) => {
            if (!app || app.state !== Shell.AppState.RUNNING) return;

            const appId = controller._getAppId(app);
            if (!appId) return;

            const counts = controller._getDictionary("app-grid-launch-counts");
            counts[appId] = (counts[appId] ?? 0) + 1;
            controller._settings.set_value(
                "app-grid-launch-counts",
                new GLib.Variant("a{si}", counts),
            );

            const lastUsed = controller._getDictionary("app-grid-last-used");
            lastUsed[appId] = Math.floor(Date.now() / 1000);
            controller._settings.set_value(
                "app-grid-last-used",
                new GLib.Variant("a{sx}", lastUsed),
            );

            if (
                controller._getOrderMode() === "usage" ||
                controller._getOrderMode() === "last-used"
            )
                appDisplay._redisplay?.();
        };

        this._appStateChangedId = appSystem.connect(
            "app-state-changed",
            appSystemChanged,
        );
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._appStateChangedId && this._appSystem) {
            this._appSystem.disconnect(this._appStateChangedId);
            this._appStateChangedId = 0;
        }

        if (
            this._appDisplay &&
            this._originalCompareItems &&
            this._appDisplay._compareItems !== this._originalCompareItems
        )
            this._appDisplay._compareItems = this._originalCompareItems;

        this._appDisplay?._redisplay?.();

        this._originalCompareItems = null;
    }

    _getOrderMode() {
        const mode = this._settings.get_string("app-grid-order");
        return ORDER_MODES.includes(mode) ? mode : "manual";
    }

    _compareOrderedItems(left, right) {
        const mode = this._getOrderMode();
        const counts = this._getDictionary("app-grid-launch-counts");
        const lastUsed = this._getDictionary("app-grid-last-used");
        const leftId = this._getItemId(left);
        const rightId = this._getItemId(right);

        if (mode === "usage")
            return (
                (counts[rightId] ?? 0) - (counts[leftId] ?? 0) ||
                this._compareNames(left, right)
            );

        if (mode === "last-used")
            return (
                (lastUsed[rightId] ?? 0) - (lastUsed[leftId] ?? 0) ||
                this._compareNames(left, right)
            );

        const nameOrder = this._compareNames(left, right);
        return mode === "name-descending" ? -nameOrder : nameOrder;
    }

    _getItemId(item) {
        return item.app ? this._getAppId(item.app) : "";
    }

    _compareNames(left, right) {
        return this._getItemName(left).localeCompare(
            this._getItemName(right),
            undefined,
            {
                sensitivity: "base",
                numeric: true,
            },
        );
    }

    _getAppName(app) {
        return (
            app.get_name?.() ?? app.get_app_info?.()?.get_display_name?.() ?? ""
        );
    }

    _getAppId(app) {
        return app.get_id?.() ?? app.get_app_info?.()?.get_id?.() ?? "";
    }

    _getItemName(item) {
        return item.name ?? this._getAppName(item.app);
    }

    _getDictionary(key) {
        return this._settings.get_value(key).deep_unpack();
    }
}
