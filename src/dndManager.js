import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as IconGrid from "resource:///org/gnome/shell/ui/iconGrid.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const DELAYED_MOVE_TIMEOUT = 100;
const REORDER_EDGE_ZONE = 60;

export class DndManager {
    constructor(appDisplay, diagnostics = null) {
        this._appDisplay = appDisplay;
        this._diagnostics = diagnostics;

        this._originalMaybeMoveItem = null;
        this._originalGetDropTarget = null;
        this._originalMoveItem = null;

        this._patchedItems = new Map();

        this._pagesChangedId = 0;
        this._dragBeginId = 0;

        this._enabled = false;
    }

    enable() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;

        if (
            !appDisplay ||
            !grid ||
            typeof appDisplay._maybeMoveItem !== "function" ||
            typeof appDisplay._getDropTarget !== "function" ||
            typeof appDisplay._moveItem !== "function"
        ) {
            this._diagnostics?.warning(
                "dnd",
                "Cannot enable DnD manager: required AppDisplay methods are missing",
            );

            return false;
        }

        if (this._enabled) return true;

        this._originalMaybeMoveItem = appDisplay._maybeMoveItem;

        this._originalGetDropTarget = appDisplay._getDropTarget;

        this._originalMoveItem = appDisplay._moveItem;

        const manager = this;

        appDisplay._maybeMoveItem = function (dragEvent) {
            return manager._maybeMoveItem(this, dragEvent);
        };

        appDisplay._getDropTarget = function (x, y, source) {
            return manager._getDropTarget(this, x, y, source);
        };

        appDisplay._moveItem = function (item, newPage, newPosition) {
            return manager._moveItem(this, item, newPage, newPosition);
        };

        this._patchAllItems();

        if (typeof grid.connect === "function") {
            this._pagesChangedId = grid.connect("pages-changed", () => {
                this._patchAllItems();
            });
        }

        this._dragBeginId = Main.overview.connect("item-drag-begin", () => {
            this._patchAllItems();
        });

        this._enabled = true;

        this._diagnostics?.event(
            "dnd",
            "DnD manager enabled",
            {
                reorderEdgeZone: REORDER_EDGE_ZONE,
            },
            "verbose",
        );

        return true;
    }

    disable() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;

        if (this._dragBeginId) {
            try {
                Main.overview.disconnect(this._dragBeginId);
            } catch {}

            this._dragBeginId = 0;
        }

        if (this._pagesChangedId && grid) {
            try {
                grid.disconnect(this._pagesChangedId);
            } catch {}

            this._pagesChangedId = 0;
        }

        for (const [item, originalWithinLeeways] of this._patchedItems) {
            if (
                item &&
                !item.is_destroyed?.() &&
                typeof originalWithinLeeways === "function"
            ) {
                item._withinLeeways = originalWithinLeeways;
            }
        }

        this._patchedItems.clear();

        if (appDisplay) {
            if (
                this._originalMaybeMoveItem &&
                appDisplay._maybeMoveItem !== this._originalMaybeMoveItem
            ) {
                appDisplay._maybeMoveItem = this._originalMaybeMoveItem;
            }

            if (
                this._originalGetDropTarget &&
                appDisplay._getDropTarget !== this._originalGetDropTarget
            ) {
                appDisplay._getDropTarget = this._originalGetDropTarget;
            }

            if (
                this._originalMoveItem &&
                appDisplay._moveItem !== this._originalMoveItem
            ) {
                appDisplay._moveItem = this._originalMoveItem;
            }

            try {
                appDisplay._removeDelayedMove?.();
            } catch (error) {
                this._diagnostics?.error(
                    "dnd",
                    "Failed to clear delayed move",
                    error,
                );
            }
        }

        this._originalMaybeMoveItem = null;
        this._originalGetDropTarget = null;
        this._originalMoveItem = null;

        this._enabled = false;

        this._diagnostics?.event("dnd", "DnD manager disabled", {}, "verbose");
    }

    _patchAllItems() {
        const grid = this._appDisplay?._grid;

        if (!grid) return;

        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);

            this._patchItem(item);
        }
    }

    _patchItem(item) {
        if (!item || item.is_destroyed?.()) return;

        if (typeof item._withinLeeways !== "function") {
            return;
        }

        if (this._patchedItems.has(item)) return;

        const originalWithinLeeways = item._withinLeeways;

        this._patchedItems.set(item, originalWithinLeeways);

        item._withinLeeways = function (x) {
            return x < REORDER_EDGE_ZONE || x > this.width - REORDER_EDGE_ZONE;
        };
    }

    _maybeMoveItem(appDisplay, dragEvent) {
        const grid = appDisplay?._grid;
        const adjustment = appDisplay?._adjustment;

        if (!grid || !dragEvent?.source) return;

        const [success, x, y] = grid.transform_stage_point(
            dragEvent.x,
            dragEvent.y,
        );

        if (!success) return;

        const source = dragEvent.source;

        const [page, position, dragLocation] = this._getDropTarget(
            appDisplay,
            x,
            y,
            source,
        );

        const item = position !== -1 ? grid.getItemAt(page, position) : null;

        if (
            item === source ||
            adjustment?.get_transition("value") !== null ||
            page !== grid.currentPage ||
            dragLocation === IconGrid.DragLocation.INVALID ||
            dragLocation === IconGrid.DragLocation.ON_ICON
        ) {
            appDisplay._removeDelayedMove?.();
            return;
        }

        if (
            !appDisplay._delayedMoveData ||
            appDisplay._delayedMoveData.page !== page ||
            appDisplay._delayedMoveData.position !== position
        ) {
            appDisplay._removeDelayedMove?.();

            appDisplay._delayedMoveData = {
                page,
                position,
                source,

                destroyId: source.connect("destroy", () =>
                    appDisplay._removeDelayedMove?.(),
                ),

                timeoutId: GLib.timeout_add_once(
                    GLib.PRIORITY_DEFAULT,
                    DELAYED_MOVE_TIMEOUT,
                    () => {
                        appDisplay._moveItem(source, page, position);

                        if (appDisplay._delayedMoveData) {
                            appDisplay._delayedMoveData.timeoutId = 0;
                        }

                        appDisplay._removeDelayedMove?.();
                    },
                ),
            };
        }
    }

    _getDropTarget(appDisplay, x, y, source) {
        const grid = appDisplay?._grid;

        if (!grid) {
            return [0, 0, IconGrid.DragLocation.INVALID];
        }

        const [sourcePage, sourcePosition] = grid.getItemPosition(source);

        let [targetPage, targetPosition, dragLocation] = grid.getDropTarget(
            x,
            y,
        );

        if (
            targetPosition >= 0 &&
            dragLocation === IconGrid.DragLocation.ON_ICON
        ) {
            const item = grid.getItemAt(targetPage, targetPosition);

            const box = item?.allocation;

            if (box) {
                if (x < box.x1 + REORDER_EDGE_ZONE) {
                    dragLocation = IconGrid.DragLocation.START_EDGE;
                } else if (x > box.x2 - REORDER_EDGE_ZONE) {
                    dragLocation = IconGrid.DragLocation.END_EDGE;
                }
            }
        }

        const isRtl =
            Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;

        if (isRtl) {
            if (dragLocation === IconGrid.DragLocation.START_EDGE) {
                dragLocation = IconGrid.DragLocation.END_EDGE;
            } else if (dragLocation === IconGrid.DragLocation.END_EDGE) {
                dragLocation = IconGrid.DragLocation.START_EDGE;
            }
        }

        let reflowDirection = Clutter.ActorAlign.END;

        if (sourcePosition === targetPosition) {
            reflowDirection = -1;
        }

        if (sourcePage === targetPage && sourcePosition < targetPosition) {
            reflowDirection = Clutter.ActorAlign.START;
        }

        if (
            !grid.layout_manager.allow_incomplete_pages &&
            sourcePage < targetPage
        ) {
            reflowDirection = Clutter.ActorAlign.START;
        }

        if (
            dragLocation === IconGrid.DragLocation.START_EDGE &&
            reflowDirection === Clutter.ActorAlign.START
        ) {
            const nColumns = grid.layout_manager.columns_per_page;

            if (Number.isFinite(nColumns) && nColumns > 0) {
                const targetColumn = targetPosition % nColumns;

                if (targetColumn > 0) {
                    targetPosition -= 1;

                    dragLocation = IconGrid.DragLocation.END_EDGE;
                }
            }
        } else if (
            dragLocation === IconGrid.DragLocation.END_EDGE &&
            reflowDirection === Clutter.ActorAlign.END
        ) {
            const nColumns = grid.layout_manager.columns_per_page;

            if (Number.isFinite(nColumns) && nColumns > 0) {
                const targetColumn = targetPosition % nColumns;

                if (targetColumn < nColumns - 1) {
                    targetPosition += 1;

                    dragLocation = IconGrid.DragLocation.START_EDGE;
                }
            }
        }

        this._diagnostics?.event(
            "dnd",
            "Drop target changed",
            {
                sourcePage,
                sourcePosition,

                targetPage,
                targetPosition,

                dragLocation,

                reflowDirection,

                edgeZone: REORDER_EDGE_ZONE,

                orientation:
                    grid.layout_manager.orientation ===
                    Clutter.Orientation.VERTICAL
                        ? "vertical"
                        : "horizontal",
            },
            "verbose",
        );

        return [targetPage, targetPosition, dragLocation];
    }

    _moveItem(appDisplay, item, newPage, newPosition) {
        const grid = appDisplay?._grid;

        if (!grid || !item) return;

        grid.moveItem(item, newPage, newPosition);

        const orderedItems = appDisplay._orderedItems;

        if (!Array.isArray(orderedItems)) return;

        const oldIndex = orderedItems.indexOf(item);

        if (oldIndex < 0) return;

        orderedItems.splice(oldIndex, 1);

        const [itemPage, itemPosition] = grid.getItemPosition(item);

        if (itemPage < 0 || itemPosition < 0) {
            return;
        }

        let linearPosition = itemPosition;

        for (let page = 0; page < itemPage; page++) {
            linearPosition += grid
                .getItemsAtPage(page)
                .filter((child) => child.visible).length;
        }

        orderedItems.splice(linearPosition, 0, item);

        this._diagnostics?.event(
            "dnd",
            "Item moved",
            {
                newPage: itemPage,
                newPosition: itemPosition,
                linearPosition,
            },
            "verbose",
        );
    }
}
