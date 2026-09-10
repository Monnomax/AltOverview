import Clutter from "gi://Clutter";
import St from "gi://St";

export class AppGridLayoutController {
    static PAGE_INDICATOR_BOTTOM_MARGIN = 20;

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
    }

    enable() {
        this._patchAppGrid();
    }

    disable() {
        this._unpatchAppGrid();
    }

    _updatePageIndicators(pageIndicators) {
        if (!pageIndicators) return;
        pageIndicators.visible = true;
        pageIndicators.get_children().forEach((indicator) => {
            indicator.add_style_class_name("page-indicator");
            indicator.visible = true;
        });
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
            pageIndicators.clear_constraints();
            pageIndicators.add_constraint(
                new Clutter.AlignConstraint({
                    source: overlay,
                    align_axis: Clutter.AlignAxis.X_AXIS,
                    factor: 0.5,
                }),
            );
            pageIndicators.add_constraint(
                new Clutter.AlignConstraint({
                    source: overlay,
                    align_axis: Clutter.AlignAxis.Y_AXIS,
                    factor: 1.0,
                }),
            );
            overlay.add_child(pageIndicators);
            boxParent.insert_child_at_index(overlay, originalIndex);
            appDisplay._chOverlayContainer = overlay;
            pageIndicators.set_style(
                `margin-bottom: ${AppGridLayoutController.PAGE_INDICATOR_BOTTOM_MARGIN}px !important;`,
            );
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
