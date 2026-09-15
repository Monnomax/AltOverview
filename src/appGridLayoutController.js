import Clutter from "gi://Clutter";
import St from "gi://St";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class AppGridLayoutController {
    static PAGE_INDICATOR_BOTTOM_MARGIN = 25;
    static PAGE_INDICATOR_EDGE_MARGIN = 25;
    static PAGE_INDICATOR_SIZE = 30;
    static PAGE_INDICATOR_ICON_SIZE = 10;

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
        this._pageNavigationContainer = null;
        this._pageNavigationOriginalParent = null;
        this._pageNavigationOriginalIndex = null;
        this._navigationButtonsLayoutManager = null;
        this._originalSyncPageIndicatorsVisibility = null;
        this._originalSyncPageIndicators = null;
        this._navigationButtonsSyncOwner = null;
        this._originalPageIndicatorsSetCurrentPosition = null;
        this._originalPageIndicatorsUpdateIndicator = null;
        this._patchAppGridIdleId = 0;
        this._startupCompleteId = 0;
    }

    enable() {
        this._patchNavigationButtons();

        // Перебудова дерева акторів (remove_child/insert_child_at_index,
        // новий overlay) в _patchAppGrid() чіпляється до Main.layoutManager
        // "startup-complete" (якщо Shell саме зараз стартує), а вже потім
        // — на idle-цикл. Виконання цього синхронно/зарано (при вході в
        // сесію) застає Shell посеред власного relayout/deferred-work
        // циклу ще до першого Dash._redisplay(), і будь-який негайний
        // запит allocation/theme-node на щойно переставлених акторах
        // провокує "needs an allocation" та TypeError у Dash (гонитва
        // черги queueDeferredWork).
        const scheduleIdle = () => {
            this._patchAppGridIdleId = GLib.idle_add(
                GLib.PRIORITY_DEFAULT_IDLE,
                () => {
                    this._patchAppGridIdleId = 0;
                    this._patchAppGrid();
                    return GLib.SOURCE_REMOVE;
                },
            );
        };

        if (Main.layoutManager._startingUp) {
            this._startupCompleteId = Main.layoutManager.connect(
                "startup-complete",
                () => {
                    Main.layoutManager.disconnect(this._startupCompleteId);
                    this._startupCompleteId = 0;
                    scheduleIdle();
                },
            );
        } else {
            scheduleIdle();
        }
    }

    disable() {
        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = 0;
        }

        if (this._patchAppGridIdleId) {
            GLib.source_remove(this._patchAppGridIdleId);
            this._patchAppGridIdleId = 0;
        }

        this._unpatchAppGrid();
        this._unpatchNavigationButtons();
    }

    _patchNavigationButtons() {
        const appDisplay = this._appDisplay;

        if (!appDisplay) return;

        const buttons = [
            appDisplay._prevPageArrow,
            appDisplay._nextPageArrow,
        ].filter(Boolean);

        if (buttons.length !== 2) return;

        const parent = buttons[0].get_parent();

        if (!parent) return;

        this._navigationButtonsParent = parent;

        this._navigationButtonsOriginalIndices = buttons.map((button) =>
            parent.get_children().indexOf(button),
        );

        /*
         * Keep GNOME's own page-visibility logic.
         */
        const syncOwner =
            typeof appDisplay._syncPageIndicatorsVisibility === "function"
                ? appDisplay
                : parent.layout_manager;

        const originalSyncVisibility = syncOwner?._syncPageIndicatorsVisibility;

        const originalSyncIndicators = syncOwner?._syncPageIndicators;

        if (
            typeof originalSyncVisibility === "function" ||
            typeof originalSyncIndicators === "function"
        ) {
            const controller = this;

            this._navigationButtonsLayoutManager = syncOwner;

            if (typeof originalSyncVisibility === "function") {
                this._originalSyncPageIndicatorsVisibility =
                    originalSyncVisibility;

                syncOwner._syncPageIndicatorsVisibility = function (...args) {
                    originalSyncVisibility.apply(this, args);

                    controller._lockNavigationButtons();
                };
            }

            if (typeof originalSyncIndicators === "function") {
                this._originalSyncPageIndicators = originalSyncIndicators;

                syncOwner._syncPageIndicators = function (...args) {
                    originalSyncIndicators.apply(this, args);

                    controller._lockNavigationButtons();
                };
            }
        }

        this._navigationButtonsChangedId = this._settings.connect(
            "changed::show-app-grid-navigation-buttons",
            () => this._updateNavigationButtons(),
        );

        this._updateNavigationButtons();
    }

    _lockNavigationButtons() {
        const appDisplay = this._appDisplay;

        if (!appDisplay) return;

        const buttons = [
            appDisplay._prevPageArrow,
            appDisplay._nextPageArrow,
        ].filter(Boolean);

        for (const button of buttons) {
            button.translation_x = 0;
            button.translation_y = 0;

            button.remove_transition("opacity");

            button.visible = true;
            button.opacity = 255;
        }

        const pageIndicators = appDisplay._pageIndicators;

        if (pageIndicators) {
            pageIndicators.translation_x = 0;
            pageIndicators.translation_y = 0;
        }

        this._enforceNavigationButtonsVisibility();
    }

    _updateNavigationButtons() {
        const appDisplay = this._appDisplay;

        if (!appDisplay) return;

        const showButtons = this._settings.get_boolean(
            "show-app-grid-navigation-buttons",
        );

        const syncOwner = this._navigationButtonsLayoutManager;
        const originalSync = this._originalSyncPageIndicatorsVisibility;

        if (syncOwner && originalSync) originalSync.call(syncOwner, false);

        this._createPageNavigation();

        this._lockNavigationButtons();

        this._enforceNavigationButtonsVisibility();

        /*
         * The navigation container now contains both:
         *
         *     previous → page indicators → next
         *
         * Keep the container alive even when the navigation buttons
         * are disabled. Only the two arrow buttons must be hidden.
         */
        if (!this._pageNavigationContainer) this._createPageNavigation();

        this._enforceNavigationButtonsVisibility();

        /*
         * Keep page indicators visible independently of the arrow
         * visibility setting.
         */
        const pageIndicators = appDisplay._pageIndicators;

        if (pageIndicators) {
            pageIndicators.visible = true;

            for (const indicator of pageIndicators.get_children?.() ?? [])
                indicator.visible = true;
        }

        if (this._pageNavigationContainer)
            this._updatePageNavigationOrientation();
    }

    _destroyPageNavigation() {
        const navigation = this._pageNavigationContainer;

        if (!navigation) return;

        const appDisplay = this._appDisplay;
        const pageIndicators = appDisplay?._pageIndicators;
        const previous = appDisplay?._prevPageArrow;
        const next = appDisplay?._nextPageArrow;

        const originalParent = this._pageNavigationOriginalParent;

        if (previous && previous.get_parent() === navigation)
            navigation.remove_child(previous);

        if (pageIndicators && pageIndicators.get_parent() === navigation)
            navigation.remove_child(pageIndicators);

        if (next && next.get_parent() === navigation)
            navigation.remove_child(next);

        if (originalParent) {
            const index = this._pageNavigationOriginalIndex ?? 0;

            originalParent.insert_child_at_index(previous, index);

            originalParent.insert_child_at_index(
                next,
                Math.min(index + 1, originalParent.get_n_children()),
            );
        }

        navigation.destroy();

        this._pageNavigationContainer = null;
        this._pageNavigationOriginalParent = null;
        this._pageNavigationOriginalIndex = null;
    }

    _createPageNavigation() {
        const appDisplay = this._appDisplay;
        const overlay = appDisplay?._chOverlayContainer;
        const pageIndicators = appDisplay?._pageIndicators;
        const previous = appDisplay?._prevPageArrow;
        const next = appDisplay?._nextPageArrow;

        if (!overlay || !pageIndicators || !previous || !next) return;

        /*
         * Already created.
         */
        if (this._pageNavigationContainer) return;

        const originalParent = previous.get_parent();

        if (!originalParent) return;

        this._pageNavigationOriginalParent = originalParent;
        this._pageNavigationOriginalIndex = originalParent
            .get_children()
            .indexOf(previous);

        /*
         * Remove arrows from GNOME's original navigation container.
         */
        if (previous.get_parent() === originalParent)
            originalParent.remove_child(previous);

        if (next.get_parent() === originalParent)
            originalParent.remove_child(next);

        /*
         * Page indicators currently belong to the AppGrid overlay.
         */
        if (pageIndicators.get_parent() === overlay)
            overlay.remove_child(pageIndicators);

        /*
         * One container for:
         *
         * horizontal:
         *
         *     previous • • • • next
         *
         * vertical:
         *
         *     previous
         *        •
         *        •
         *        •
         *       next
         */
        const navigation = new St.Widget({
            name: "ch-page-navigation",
            layout_manager: new Clutter.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                spacing: 0,
            }),
            x_expand: false,
            y_expand: false,
        });

        navigation.set_style(
            "spacing: 0px !important; margin: 0px !important; padding: 0px !important;",
        );

        /*
         * The exact order is important.
         */
        navigation.add_child(previous);
        navigation.add_child(pageIndicators);
        navigation.add_child(next);

        overlay.add_child(navigation);

        this._pageNavigationContainer = navigation;

        this._applyNavigationArrowStyle();
        this._updatePageNavigationOrientation();
    }

    _updatePageNavigationOrientation() {
        const navigation = this._pageNavigationContainer;
        const overlay = this._appDisplay?._chOverlayContainer;

        if (!navigation || !overlay) return;

        const vertical =
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical";

        const layout = navigation.layout_manager;

        layout.orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;

        this._updateNavigationButtonIcons(vertical);

        /*
         * No gap between:
         *
         * previous → indicators → next
         */
        layout.spacing = 0;

        const width = navigation.width;
        const height = navigation.height;

        if (width <= 0 || height <= 0) return;

        if (vertical) {
            /*
             * Right side, vertically centered.
             */
            navigation.set_position(
                Math.round(
                    overlay.width -
                        navigation.width -
                        AppGridLayoutController.PAGE_INDICATOR_EDGE_MARGIN,
                ),
                Math.round((overlay.height - navigation.height) / 2),
            );
        } else {
            /*
             * Bottom center.
             */
            navigation.set_position(
                Math.round((overlay.width - navigation.width) / 2),
                Math.round(
                    overlay.height -
                        navigation.height -
                        AppGridLayoutController.PAGE_INDICATOR_BOTTOM_MARGIN,
                ),
            );
        }

        navigation.queue_relayout();
    }

    _applyNavigationArrowStyle() {
        const appDisplay = this._appDisplay;

        if (!appDisplay) return;

        const buttons = [
            appDisplay._prevPageArrow,
            appDisplay._nextPageArrow,
        ].filter(Boolean);
        const pageIndicators = appDisplay._pageIndicators;

        if (
            pageIndicators &&
            !this._originalPageIndicatorsSetCurrentPosition &&
            typeof pageIndicators.setCurrentPosition === "function"
        ) {
            const originalSetCurrentPosition =
                pageIndicators.setCurrentPosition;

            this._originalPageIndicatorsSetCurrentPosition =
                originalSetCurrentPosition;

            pageIndicators.setCurrentPosition = function (...args) {
                originalSetCurrentPosition.apply(this, args);

                for (const indicator of this.get_children()) {
                    const icon = indicator.child;

                    if (!icon) continue;

                    icon.scale_x = 1;
                    icon.scale_y = 1;
                }
            };
        }
        const indicators = pageIndicators?.get_children?.() ?? [];
        const activeIndicator = indicators.find(
            (indicator) => indicator.checked === true,
        );
        const activeColor = activeIndicator
            ?.get_theme_node?.()
            ?.get_background_color?.()
            ?.to_string?.();

        for (const button of buttons) {
            button.set_style(`
                background-color: transparent !important;
                border: 0 !important;
                border-radius: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
            `);

            const icon = button
                .get_children()
                ?.find((child) => typeof child.set_style === "function");

            if (!icon) continue;

            icon.set_style(`
                margin: 0 !important;
                padding: 0 !important;
                color: ${activeColor ?? "-st-accent-color"} !important;
            `);

            icon.add_style_class_name("ch-page-navigation-icon");
        }
    }

    _updateNavigationButtonIcons(vertical) {
        const appDisplay = this._appDisplay;
        const buttons = [
            [
                appDisplay?._prevPageArrow,
                vertical ? "go-up-symbolic" : "go-previous-symbolic",
            ],
            [
                appDisplay?._nextPageArrow,
                vertical ? "go-down-symbolic" : "go-next-symbolic",
            ],
        ];

        for (const [button, iconName] of buttons) {
            if (!button) continue;

            const findIcon = (actor) => {
                if (!actor) return null;
                if (actor.icon_name !== undefined) return actor;

                for (const child of actor.get_children?.() ?? []) {
                    const icon = findIcon(child);
                    if (icon) return icon;
                }

                return null;
            };

            const icon = findIcon(button);
            if (icon) icon.icon_name = iconName;
        }
    }

    _enforceNavigationButtonsVisibility() {
        const appDisplay = this._appDisplay;

        if (!appDisplay) return;

        const buttons = [
            appDisplay._prevPageArrow,
            appDisplay._nextPageArrow,
        ].filter(Boolean);

        const showButtons = this._settings.get_boolean(
            "show-app-grid-navigation-buttons",
        );

        for (const button of buttons) {
            button.visible = showButtons;
            button.opacity = showButtons ? 255 : 0;
            button.reactive = showButtons;
            button.can_focus = showButtons;
        }
    }

    _unpatchNavigationButtons() {
        if (
            this._navigationButtonsLayoutManager &&
            this._originalSyncPageIndicatorsVisibility &&
            this._navigationButtonsLayoutManager
                ._syncPageIndicatorsVisibility !==
                this._originalSyncPageIndicatorsVisibility
        ) {
            this._navigationButtonsLayoutManager._syncPageIndicatorsVisibility =
                this._originalSyncPageIndicatorsVisibility;
        }

        if (
            this._navigationButtonsLayoutManager &&
            this._originalSyncPageIndicators &&
            this._navigationButtonsLayoutManager._syncPageIndicators !==
                this._originalSyncPageIndicators
        ) {
            this._navigationButtonsLayoutManager._syncPageIndicators =
                this._originalSyncPageIndicators;
        }

        this._navigationButtonsLayoutManager = null;
        this._originalSyncPageIndicatorsVisibility = null;
        this._originalSyncPageIndicators = null;
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
            const box = actor.get_allocation_box();
            const allocX = Math.round(box.x1);
            const allocY = Math.round(box.y1);
            const allocW = Math.round(box.x2 - box.x1);
            const allocH = Math.round(box.y2 - box.y1);

            log(
                `${indent}${actor.constructor?.name ?? "unknown"} ` +
                    `name=${actor.name ?? "null"} ` +
                    `alloc=(${allocX},${allocY} ${allocW}x${allocH}) ` +
                    `x_align=${actor.x_align} y_align=${actor.y_align} ` +
                    `x_expand=${actor.x_expand} y_expand=${actor.y_expand} ` +
                    `x_fill=${actor.x_fill ?? "n/a"} y_fill=${actor.y_fill ?? "n/a"} ` +
                    `layout_manager=${actor.layout_manager?.constructor?.name ?? "none"}`,
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

        pageIndicators.orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;

        if (!vertical) {
            pageIndicators.y_align = Clutter.ActorAlign.CENTER;
            pageIndicators.y_expand = false;
        }

        const indicators = pageIndicators.get_children();

        for (const indicator of indicators) {
            indicator.set_style(
                `width: ${AppGridLayoutController.PAGE_INDICATOR_SIZE}px !important; ` +
                    `height: ${AppGridLayoutController.PAGE_INDICATOR_SIZE}px !important; ` +
                    `padding: 0 !important; ` +
                    `margin: 0 !important; ` +
                    `border: 0 !important;`,
            );

            indicator.add_style_class_name("page-indicator");
            indicator.visible = true;

            if (!vertical) {
                indicator.y_align = Clutter.ActorAlign.CENTER;
                indicator.y_expand = false;
            }

            indicator.set_size(
                AppGridLayoutController.PAGE_INDICATOR_SIZE,
                AppGridLayoutController.PAGE_INDICATOR_SIZE,
            );

            const children = indicator.get_children?.() ?? [];
            const icon = children[0];

            if (!icon) continue;

            const iconSize = AppGridLayoutController.PAGE_INDICATOR_ICON_SIZE;

            icon.set_style(
                `width: ${iconSize}px !important; ` +
                    `height: ${iconSize}px !important; ` +
                    `min-width: ${iconSize}px !important; ` +
                    `min-height: ${iconSize}px !important; ` +
                    `max-width: ${iconSize}px !important; ` +
                    `max-height: ${iconSize}px !important; ` +
                    `margin: 0 !important; ` +
                    `padding: 0 !important;`,
            );

            icon.x_align = Clutter.ActorAlign.CENTER;
            icon.y_align = Clutter.ActorAlign.CENTER;
            icon.x_expand = false;
            icon.y_expand = false;

            // GNOME changes this during _updateIndicator().
            // The _updateIndicator() wrapper keeps it at 1.
            icon.scale_x = 1;
            icon.scale_y = 1;
        }

        if (this._pageNavigationContainer) {
            this._applyNavigationArrowStyle();
            this._updatePageNavigationOrientation();
        }
    }

    _patchAppGrid() {
        const appDisplay = this._appDisplay;
        const gridActor = appDisplay?._grid;
        if (!appDisplay || !gridActor) return;

        const scrollView = appDisplay._scrollView;
        const pageIndicators = appDisplay._pageIndicators;

        if (
            pageIndicators &&
            !this._originalPageIndicatorsUpdateIndicator &&
            typeof pageIndicators._updateIndicator === "function"
        ) {
            const originalUpdateIndicator = pageIndicators._updateIndicator;

            this._originalPageIndicatorsUpdateIndicator =
                originalUpdateIndicator;

            pageIndicators._updateIndicator = function (indicator, pageIndex) {
                originalUpdateIndicator.call(this, indicator, pageIndex);

                const icon = indicator?.child;

                if (!icon) return;

                icon.set_scale(1, 1);
            };
        }
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

            boxParent.insert_child_at_index(overlay, originalIndex);
            appDisplay._chOverlayContainer = overlay;
            this._updatePageIndicators(pageIndicators);
            this._createPageNavigation();
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
        this._destroyPageNavigation();
        const overlay = appDisplay?._chOverlayContainer;
        if (overlay && this._pageIndicatorsOriginalParent) {
            const scrollViewTopLevel =
                this._chScrollViewTopLevel ?? appDisplay._scrollView;
            const pageIndicators = appDisplay._pageIndicators;
            if (
                pageIndicators &&
                !this._originalPageIndicatorsUpdateIndicator &&
                typeof pageIndicators._updateIndicator === "function"
            ) {
                const originalUpdateIndicator = pageIndicators._updateIndicator;

                this._originalPageIndicatorsUpdateIndicator =
                    originalUpdateIndicator;

                const controller = this;

                pageIndicators._updateIndicator = function (
                    indicator,
                    pageIndex,
                ) {
                    originalUpdateIndicator.call(this, indicator, pageIndex);

                    const icon = indicator?.child;

                    if (!icon) return;

                    icon.scale_x = 1;
                    icon.scale_y = 1;
                };
            }
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

        const pageIndicators = this._appDisplay?._pageIndicators;

        if (pageIndicators && this._originalPageIndicatorsUpdateIndicator) {
            pageIndicators._updateIndicator =
                this._originalPageIndicatorsUpdateIndicator;

            this._originalPageIndicatorsUpdateIndicator = null;
        }

        if (pageIndicators && this._originalPageIndicatorsSetCurrentPosition) {
            pageIndicators.setCurrentPosition =
                this._originalPageIndicatorsSetCurrentPosition;

            this._originalPageIndicatorsSetCurrentPosition = null;
        }

        if (pageIndicators && this._originalPageIndicatorsUpdateIndicator) {
            pageIndicators._updateIndicator =
                this._originalPageIndicatorsUpdateIndicator;

            this._originalPageIndicatorsUpdateIndicator = null;
        }
    }
}
