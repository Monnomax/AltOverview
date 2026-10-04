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
        this._dragEndId = 0;

        this._lastDropTargetDiagnostic = null;

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
            this._lastDropTargetDiagnostic = null;
            this._patchAllItems();
        });

        this._dragEndId = Main.overview.connect("item-drag-end", () => {
            appDisplay._removeDelayedMove?.();
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

        if (this._dragEndId) {
            try {
                Main.overview.disconnect(this._dragEndId);
            } catch {}

            this._dragEndId = 0;
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

        this._lastDropTargetDiagnostic = null;

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

    /*
     * Returns true when EMPTY_SPACE would simply append the source
     * item immediately after its current position, meaning that the
     * source is already the last visible item on the target page.
     *
     * This prevents:
     *
     *     EMPTY_SPACE -> move -> EMPTY_SPACE -> move -> ...
     *
     * while the pointer remains stationary at the end of a page.
     */
    _isAlreadyAtAppendPosition(appDisplay, page, source) {
        const grid = appDisplay?._grid;

        if (!grid || !source || page < 0) return false;

        const [sourcePage, sourcePosition] = grid.getItemPosition(source);

        if (sourcePage !== page || sourcePosition < 0) {
            return false;
        }

        const pageItems = grid
            .getItemsAtPage(page)
            .filter((child) => child.visible);

        if (pageItems.length === 0) return false;

        return sourcePosition === pageItems.length - 1;
    }

    _hasUsableGridGeometry(grid) {
        const layout = grid?.layout_manager;

        return (
            Number.isFinite(layout?._pageWidth) &&
            layout._pageWidth > 0 &&
            Number.isFinite(layout?._pageHeight) &&
            layout._pageHeight > 0 &&
            Number.isFinite(layout?.columns_per_page) &&
            layout.columns_per_page > 0 &&
            Number.isFinite(layout?.rows_per_page) &&
            layout.rows_per_page > 0
        );
    }

    _maybeMoveItem(appDisplay, dragEvent) {
        const grid = appDisplay?._grid;

        const adjustment = appDisplay?._adjustment;

        if (!grid || !dragEvent?.source) {
            return;
        }

        if (!this._hasUsableGridGeometry(grid)) {
            appDisplay._removeDelayedMove?.();
            return;
        }

        if (
            !Number.isFinite(dragEvent.x) ||
            !Number.isFinite(dragEvent.y)
        ) {
            appDisplay._removeDelayedMove?.();
            return;
        }

        const [success, x, y] = grid.transform_stage_point(
            dragEvent.x,
            dragEvent.y,
        );

        if (
            !success ||
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            appDisplay._removeDelayedMove?.();
            return;
        }

        const source = dragEvent.source;

        const [page, position, dragLocation] = this._getDropTarget(
            appDisplay,
            x,
            y,
            source,
        );

        if (
            !Number.isInteger(page) ||
            page < 0 ||
            !Number.isInteger(position) ||
            position < -1
        ) {
            appDisplay._removeDelayedMove?.();
            return;
        }

        const item = position >= 0 ? grid.getItemAt(page, position) : null;

        /*
         * EMPTY_SPACE means append.
         *
         * When the source has already reached the last visible item
         * on this page, there is nothing left to do. Without this
         * guard a stationary pointer at the end of the page causes
         * grid.moveItem() to execute every 100 ms.
         */
        if (
            position === -1 &&
            dragLocation === IconGrid.DragLocation.EMPTY_SPACE &&
            this._isAlreadyAtAppendPosition(appDisplay, page, source)
        ) {
            appDisplay._removeDelayedMove?.();

            this._diagnostics?.event(
                "dnd",
                "Append target already reached",
                {
                    page,
                    sourcePage: grid.getItemPosition(source)[0],
                    sourcePosition: grid.getItemPosition(source)[1],
                },
                "verbose",
            );

            return;
        }

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

            const delayedMoveData = {
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
                        if (appDisplay._delayedMoveData !== delayedMoveData) {
                            return;
                        }

                        if (
                            source.is_destroyed?.() ||
                            source.get_parent?.() !== grid ||
                            grid.currentPage !== page ||
                            !this._hasUsableGridGeometry(grid)
                        ) {
                            appDisplay._removeDelayedMove?.();
                            return;
                        }

                        appDisplay._moveItem(source, page, position);

                        if (appDisplay._delayedMoveData) {
                            appDisplay._delayedMoveData.timeoutId = 0;
                        }

                        appDisplay._removeDelayedMove?.();
                    },
                ),
            };

            appDisplay._delayedMoveData = delayedMoveData;
        }
    }

    _getDropTarget(appDisplay, x, y, source) {
        const grid = appDisplay?._grid;

        if (!grid || !Number.isFinite(x) || !Number.isFinite(y)) {
            return [0, 0, IconGrid.DragLocation.INVALID];
        }

        const [sourcePage, sourcePosition] = grid.getItemPosition(source);

        const [rawTargetPage, rawTargetPosition, rawDragLocation] =
            grid.getDropTarget(x, y);

        if (
            !Number.isInteger(rawTargetPage) ||
            !Number.isInteger(rawTargetPosition) ||
            rawTargetPosition < -1
        ) {
            return [0, 0, IconGrid.DragLocation.INVALID];
        }

        let targetPage = rawTargetPage;

        let targetPosition = rawTargetPosition;

        let dragLocation = rawDragLocation;

        /*
         * Keep GNOME 50's EMPTY_SPACE sentinel.
         *
         * -1 means "append".
         * It must not be converted to the last icon position.
         */

        /*
         * Extend the native horizontal edge zone.
         *
         * GNOME determines START_EDGE / END_EDGE using X even when
         * the grid orientation is vertical. We intentionally keep
         * that behavior.
         */
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

        /*
         * Native GNOME 50 edge correction.
         *
         * Important: this is intentionally performed only for a
         * real icon position. EMPTY_SPACE remains -1.
         */
        const nColumns = grid.layout_manager.columns_per_page;

        if (
            targetPosition >= 0 &&
            dragLocation === IconGrid.DragLocation.START_EDGE &&
            reflowDirection === Clutter.ActorAlign.START &&
            Number.isFinite(nColumns) &&
            nColumns > 0
        ) {
            const targetColumn = targetPosition % nColumns;

            if (targetColumn > 0) {
                targetPosition -= 1;

                dragLocation = IconGrid.DragLocation.END_EDGE;
            }
        } else if (
            targetPosition >= 0 &&
            dragLocation === IconGrid.DragLocation.END_EDGE &&
            reflowDirection === Clutter.ActorAlign.END &&
            Number.isFinite(nColumns) &&
            nColumns > 0
        ) {
            const targetColumn = targetPosition % nColumns;

            if (targetColumn < nColumns - 1) {
                targetPosition += 1;

                dragLocation = IconGrid.DragLocation.START_EDGE;
            }
        }

        /*
         * Diagnostics.
         */
        const orientation =
            grid.layout_manager.orientation === Clutter.Orientation.VERTICAL
                ? "vertical"
                : "horizontal";

        const diagnosticSignature = JSON.stringify({
            sourcePage,
            sourcePosition,

            rawTargetPage,
            rawTargetPosition,
            rawDragLocation,

            targetPage,
            targetPosition,
            dragLocation,

            currentPage: grid.currentPage ?? -1,
        });

        if (diagnosticSignature !== this._lastDropTargetDiagnostic) {
            this._lastDropTargetDiagnostic = diagnosticSignature;

            this._diagnostics?.event(
                "dnd",
                "Drop target changed",
                {
                    sourcePage,
                    sourcePosition,

                    rawTargetPage,
                    rawTargetPosition,
                    rawDragLocation,

                    targetPage,
                    targetPosition,
                    dragLocation,

                    reflowDirection,

                    currentPage: grid.currentPage ?? -1,

                    x,
                    y,

                    adjustmentValue: appDisplay?._adjustment?.value ?? null,

                    adjustmentPageSize:
                        appDisplay?._adjustment?.page_size ?? null,

                    edgeZone: REORDER_EDGE_ZONE,

                    orientation,
                },
                "verbose",
            );
        }

        return [targetPage, targetPosition, dragLocation];
    }

    _moveItem(appDisplay, item, newPage, newPosition) {
        const grid = appDisplay?._grid;

        if (
            !grid ||
            !item ||
            !this._hasUsableGridGeometry(grid) ||
            !Number.isInteger(newPage) ||
            newPage < 0 ||
            !Number.isInteger(newPosition) ||
            newPosition < -1
        )
            return;

        /*
         * Preserve GNOME 50 behavior exactly:
         *
         * newPosition === -1
         * means append.
         */
        grid.moveItem(item, newPage, newPosition);

        /*
         * Keep _orderedItems synchronized using GNOME's own
         * _getLinearPosition() instead of duplicating the calculation.
         */
        const orderedItems = appDisplay._orderedItems;

        if (!Array.isArray(orderedItems)) return;

        const oldIndex = orderedItems.indexOf(item);

        if (oldIndex < 0) return;

        orderedItems.splice(oldIndex, 1);

        if (typeof appDisplay._getLinearPosition === "function") {
            orderedItems.splice(appDisplay._getLinearPosition(item), 0, item);
        }

        const [itemPage, itemPosition] = grid.getItemPosition(item);

        this._diagnostics?.event(
            "dnd",
            "Item moved",
            {
                newPage: itemPage,
                newPosition: itemPosition,
                linearPosition:
                    typeof appDisplay._getLinearPosition === "function"
                        ? appDisplay._getLinearPosition(item)
                        : null,
            },
            "verbose",
        );
    }
}
