import Clutter from "gi://Clutter";
import St from "gi://St";
import GLib from "gi://GLib";

export class AppGridLayoutController {
    static PAGE_INDICATOR_BOTTOM_MARGIN = 20;
    static PAGE_INDICATOR_EDGE_MARGIN = 20;
    static PAGE_INDICATOR_SPACING = 25;

    constructor(settings, appDisplay, iconController) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._iconController = iconController;
        this._originalAdaptToSize = null;
        this._pageIndicatorsOriginalParent = null;
        this._pageIndicatorsOriginalIndex = null;
        this._originalScrollViewExpand = null;
        this._originalPageIndicatorsAlign = null;
        this._originalPageIndicatorsExpand = null;
        this._chScrollViewTopLevel = null;
        this._navigationButtonsChangedId = 0;
        this._navigationButtonsParent = null;
        this._navigationButtonsOriginalIndices = [];
    }

    enable() {
        this._patchNavigationButtons();
        this._patchAppGrid();
    }

    disable() {
        this._unpatchAppGrid();
        this._unpatchNavigationButtons();
    }

    _patchNavigationButtons() {
    const appDisplay = this._appDisplay;

    if (!appDisplay)
        return;

    const buttons = [
        appDisplay._nextPageArrow,
        appDisplay._prevPageArrow,
    ].filter(Boolean);

    if (buttons.length === 0)
        return;

    const parent = buttons[0].get_parent();

    if (!parent)
        return;

    this._navigationButtonsParent = parent;
    this._navigationButtonsOriginalIndices = buttons.map(button =>
        parent.get_children().indexOf(button)
    );

    this._navigationButtonsChangedId = this._settings.connect(
        "changed::show-app-grid-navigation-buttons",
        () => this._updateNavigationButtons()
    );

    this._updateNavigationButtons();
}

_updateNavigationButtons() {
    const appDisplay = this._appDisplay;
    const parent = this._navigationButtonsParent;

    if (!appDisplay || !parent)
        return;

    const buttons = [
        appDisplay._nextPageArrow,
        appDisplay._prevPageArrow,
    ].filter(Boolean);

    const showButtons = this._settings.get_boolean(
        "show-app-grid-navigation-buttons"
    );

    if (!showButtons) {
        for (const button of buttons) {
            if (button.get_parent() === parent)
                parent.remove_child(button);

            button.remove_transition("opacity");
            button.visible = false;
            button.opacity = 0;
            button.reactive = false;
        }

        return;
    }

    for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];

        if (button.get_parent() !== parent) {
            parent.insert_child_at_index(
                button,
                this._navigationButtonsOriginalIndices[i]
            );
        }

        button.remove_transition("opacity");
        button.visible = true;
        button.opacity = 255;
        button.reactive = true;
    }

    const layoutManager = parent.layout_manager;

    if (layoutManager?._syncPageIndicatorsVisibility)
        layoutManager._syncPageIndicatorsVisibility(false);
}

_unpatchNavigationButtons() {
    if (this._navigationButtonsChangedId) {
        this._settings.disconnect(this._navigationButtonsChangedId);
        this._navigationButtonsChangedId = 0;
    }

    const appDisplay = this._appDisplay;
    const parent = this._navigationButtonsParent;

    if (!appDisplay || !parent)
        return;

    const buttons = [
        appDisplay._nextPageArrow,
        appDisplay._prevPageArrow,
    ].filter(Boolean);

    for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];

        if (button.get_parent() !== parent) {
            parent.insert_child_at_index(
                button,
                this._navigationButtonsOriginalIndices[i]
            );
        }

        button.remove_transition("opacity");
        button.visible = true;
        button.opacity = 255;
        button.reactive = true;
    }

    this._navigationButtonsParent = null;
    this._navigationButtonsOriginalIndices = [];
}

    _hideNavigationButtons() {
        for (const button of [
            this._appDisplay?._nextPageArrow,
            this._appDisplay?._prevPageArrow,
        ]) {
            if (!button) continue;

            button.remove_transition("opacity");
            button.hide();
            button.visible = false;
            button.opacity = 0;
            button.reactive = false;
        }
    }

    _debugPageIndicators(pageIndicators) {
        if (!pageIndicators) return;

        const dump = (actor, depth = 0) => {
            const indent = "  ".repeat(depth);

            log(
                `${indent}${actor.constructor?.name ?? "unknown"} ` +
                    `name=${actor.name ?? "null"} ` +
                    `x=${actor.x} y=${actor.y} ` +
                    `w=${actor.width} h=${actor.height} ` +
                    `x_align=${actor.x_align} y_align=${actor.y_align} ` +
                    `x_expand=${actor.x_expand} y_expand=${actor.y_expand}`,
            );

            if (actor.get_children) {
                for (const child of actor.get_children())
                    dump(child, depth + 1);
            }
        };

        log("========== PAGE INDICATORS ==========");
        dump(pageIndicators);
        log("=====================================");
    }

    _updatePageIndicators(pageIndicators) {
        if (!pageIndicators) return;

        pageIndicators.visible = true;

        const vertical =
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical";

        pageIndicators.vertical = vertical;

        if (vertical) {
            for (const indicator of pageIndicators.get_children()) {
                indicator.set_style(
                    `height: ${AppGridLayoutController.PAGE_INDICATOR_SPACING}px !important;`,
                );
            }
        } else {
            for (const indicator of pageIndicators.get_children())
                indicator.set_style(null);
        }

        pageIndicators.get_children().forEach((indicator) => {
            indicator.add_style_class_name("page-indicator");
            indicator.visible = true;
        });

        const overlay = this._appDisplay?._chOverlayContainer;

        if (!overlay) return;

        if (overlay.width <= 0 || overlay.height <= 0) return;

        if (pageIndicators.width <= 0 || pageIndicators.height <= 0) return;

        if (vertical) {
            // Видима крапка: 20 px від правого краю.
            pageIndicators.x = Math.round(
                overlay.width -
                    pageIndicators.width +
                    12 -
                    AppGridLayoutController.PAGE_INDICATOR_EDGE_MARGIN,
            );

            // По вертикалі — по центру.
            pageIndicators.y = Math.round(
                (overlay.height - pageIndicators.height) / 2,
            );
        } else {
            // Горизонтально: по центру, 20 px від нижнього краю.
            pageIndicators.x = Math.round(
                (overlay.width - pageIndicators.width) / 2,
            );

            pageIndicators.y = Math.round(
                overlay.height -
                    pageIndicators.height -
                    AppGridLayoutController.PAGE_INDICATOR_BOTTOM_MARGIN,
            );
        }
    }

    _patchAppGrid() {
        const appDisplay = this._appDisplay;
        const gridActor = appDisplay?._grid;
        if (!appDisplay || !gridActor) return;

        const scrollView = appDisplay._scrollView;
        const pageIndicators = appDisplay._pageIndicators;
        const boxParent = pageIndicators?.get_parent() ?? null;
        let scrollViewTopLevel = scrollView;
        while (
            scrollViewTopLevel &&
            boxParent &&
            scrollViewTopLevel.get_parent() !== boxParent
        )
            scrollViewTopLevel = scrollViewTopLevel.get_parent();

        if (
            scrollView &&
            pageIndicators &&
            !appDisplay._chOverlayContainer &&
            boxParent &&
            scrollViewTopLevel &&
            scrollViewTopLevel.get_parent() === boxParent &&
            scrollViewTopLevel !== pageIndicators
        ) {
            const originalIndex = boxParent
                .get_children()
                .indexOf(scrollViewTopLevel);
            this._pageIndicatorsOriginalParent = boxParent;
            this._pageIndicatorsOriginalIndex = originalIndex;
            this._originalScrollViewExpand = {
                x: scrollViewTopLevel.x_expand,
                y: scrollViewTopLevel.y_expand,
            };
            this._originalPageIndicatorsAlign = {
                x: pageIndicators.x_align,
                y: pageIndicators.y_align,
            };
            this._originalPageIndicatorsExpand = {
                x: pageIndicators.x_expand,
                y: pageIndicators.y_expand,
            };
            this._chScrollViewTopLevel = scrollViewTopLevel;

            boxParent.remove_child(scrollViewTopLevel);
            boxParent.remove_child(pageIndicators);
            const overlay = new St.Widget({
                name: "ch-app-grid-overlay",
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            scrollViewTopLevel.x_expand = true;
            scrollViewTopLevel.y_expand = true;
            overlay.add_child(scrollViewTopLevel);

            pageIndicators.x_expand = false;
            pageIndicators.y_expand = false;

            overlay.add_child(pageIndicators);
            boxParent.insert_child_at_index(overlay, originalIndex);
            appDisplay._chOverlayContainer = overlay;
        }

        if (pageIndicators) {
            pageIndicators.clip_to_allocation = false;
            this._updatePageIndicators(pageIndicators);
        }

        gridActor.set_style(
            "margin-bottom: 0px !important; margin-top: 0px !important; padding-bottom: 0px !important;",
        );
        gridActor.y_expand = true;
        scrollView?.set_style(
            "margin-bottom: 0px !important; padding-bottom: 0px !important;",
        );
        if (scrollView) scrollView.y_expand = true;
        appDisplay.set_style(
            "margin-bottom: 0px !important; padding-bottom: 0px !important;",
        );

        const layoutManager = gridActor.layout_manager;
        if (layoutManager._customGridPatched) return;
        this._originalAdaptToSize = layoutManager.adaptToSize;
        const controller = this;
        layoutManager.adaptToSize = function (width, height) {
            controller._originalAdaptToSize.call(this, width, height);
            controller._updatePageIndicators(appDisplay._pageIndicators);
            if (this.page_padding) {
                this.page_padding.bottom = 0;
                this.page_padding.top = 0;
            }

            const cols = controller._settings.get_int("app-grid-columns");
            const rows = controller._settings.get_int("app-grid-rows");
            this.columns_per_page = cols;
            this.rows_per_page = rows;
            const padding = this.page_padding;
            const availWidth = width - padding.left - padding.right;
            const availHeight = height - padding.top - padding.bottom;
            if (
                ![width, height, availWidth, availHeight].every(
                    Number.isFinite,
                ) ||
                availWidth <= 0 ||
                availHeight <= 0 ||
                cols <= 0 ||
                rows <= 0
            )
                return;

            if (gridActor.get_n_children() === 0) return;
            for (let index = 0; index < gridActor.get_n_children(); index++)
                controller._iconController.applyIconSize(
                    gridActor.get_child_at_index(index),
                );

            const child = gridActor.get_child_at_index(0);
            const [, naturalWidth] = child.get_preferred_width(-1);
            const [, naturalHeight] = child.get_preferred_height(naturalWidth);
            const childWidth = naturalWidth || 100;
            const childHeight = naturalHeight || 120;
            const minSpacing = 10;
            const slotWidth = (availWidth - (cols - 1) * minSpacing) / cols;
            const slotHeight = (availHeight - (rows - 1) * minSpacing) / rows;
            let scale = 1.0;
            if (childWidth > slotWidth || childHeight > slotHeight)
                scale = Math.min(
                    slotWidth / childWidth,
                    slotHeight / childHeight,
                );

            const mode = controller._settings.get_string(
                "app-grid-names-visibility",
            );
            for (let index = 0; index < gridActor.get_n_children(); index++) {
                const item = gridActor.get_child_at_index(index);
                item.set_pivot_point(0.5, 0.5);
                item.set_scale(scale, scale);
                controller._iconController.applyNameVisibilityMode(item, mode);
            }
        };
        layoutManager._customGridPatched = true;
        gridActor.queue_relayout();
    }

    _unpatchAppGrid() {
        const appDisplay = this._appDisplay;
        const overlay = appDisplay?._chOverlayContainer;
        if (overlay && this._pageIndicatorsOriginalParent) {
            const scrollViewTopLevel =
                this._chScrollViewTopLevel ?? appDisplay._scrollView;
            const pageIndicators = appDisplay._pageIndicators;
            const parent = this._pageIndicatorsOriginalParent;
            const index = this._pageIndicatorsOriginalIndex ?? 0;
            if (scrollViewTopLevel) overlay.remove_child(scrollViewTopLevel);
            if (pageIndicators) overlay.remove_child(pageIndicators);
            if (scrollViewTopLevel) {
                if (this._originalScrollViewExpand) {
                    scrollViewTopLevel.x_expand =
                        this._originalScrollViewExpand.x;
                    scrollViewTopLevel.y_expand =
                        this._originalScrollViewExpand.y;
                }
                parent.insert_child_at_index(scrollViewTopLevel, index);
            }
            if (pageIndicators) {
                if (this._originalPageIndicatorsAlign) {
                    pageIndicators.x_align =
                        this._originalPageIndicatorsAlign.x;
                    pageIndicators.y_align =
                        this._originalPageIndicatorsAlign.y;
                }
                if (this._originalPageIndicatorsExpand) {
                    pageIndicators.x_expand =
                        this._originalPageIndicatorsExpand.x;
                    pageIndicators.y_expand =
                        this._originalPageIndicatorsExpand.y;
                }
                pageIndicators.clear_constraints();
                pageIndicators.set_style(null);
                pageIndicators.clip_to_allocation = true;
                parent.insert_child_at_index(pageIndicators, index + 1);
            }
            overlay.destroy();
            delete appDisplay._chOverlayContainer;
        }

        this._pageIndicatorsOriginalParent = null;
        this._pageIndicatorsOriginalIndex = null;
        this._originalScrollViewExpand = null;
        this._originalPageIndicatorsAlign = null;
        this._originalPageIndicatorsExpand = null;
        this._chScrollViewTopLevel = null;

        if (appDisplay) {
            appDisplay.set_style(null);
            appDisplay._scrollView?.set_style(null);
            const gridActor = appDisplay._grid;
            if (gridActor) {
                gridActor.set_style(null);
                const layoutManager = gridActor.layout_manager;
                if (layoutManager && this._originalAdaptToSize) {
                    layoutManager.adaptToSize = this._originalAdaptToSize;
                    delete layoutManager._customGridPatched;
                    for (
                        let index = 0;
                        index < gridActor.get_n_children();
                        index++
                    )
                        gridActor.get_child_at_index(index).set_scale(1.0, 1.0);
                    gridActor.queue_relayout();
                }
            }
        }
        this._originalAdaptToSize = null;
    }
}
