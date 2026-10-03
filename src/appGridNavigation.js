import Clutter from "gi://Clutter";
import St from "gi://St";

export class AppGridNavigation {
    static PAGE_INDICATOR_BOTTOM_MARGIN = 10;
    static PAGE_INDICATOR_EDGE_MARGIN = 10;
    static PAGE_INDICATOR_SIZE = 30;
    static PAGE_INDICATOR_ICON_SIZE = 10;

    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._originalParent = null;
        this._originalIndex = null;
        this._originalScrollViewExpand = null;
        this._originalIndicatorsAlign = null;
        this._originalIndicatorsExpand = null;
        this._scrollViewTopLevel = null;
        this._navigationButtonsChangedId = 0;
        this._navigationButtonsParent = null;
        this._navigationButtonsOriginalIndices = [];
        this._navigation = null;
        this._navigationOriginalParent = null;
        this._navigationOriginalIndex = null;
        this._navigationButtonsSyncOwner = null;
        this._originalSyncIndicatorsVisibility = null;
        this._originalSyncIndicators = null;
        this._previousButton = null;
        this._nextButton = null;
        this._originalUpdateIndicator = null;
    }

    enable() {
        this._patchNavigationButtons();
    }

    disable() {
        this.unmount();
        this._unpatchNavigationButtons();
        this._unpatchPageIndicators();
    }

    mount(scrollView) {
        const appDisplay = this._appDisplay;
        const pageIndicators = appDisplay?._pageIndicators;

        if (!appDisplay || !scrollView || !pageIndicators) return;

        this._patchPageIndicators(pageIndicators);

        const boxParent = pageIndicators.get_parent?.() ?? null;
        let scrollViewTopLevel = scrollView;

        while (
            scrollViewTopLevel &&
            boxParent &&
            scrollViewTopLevel.get_parent() !== boxParent
        ) {
            scrollViewTopLevel = scrollViewTopLevel.get_parent();
        }

        if (
            appDisplay._chOverlayContainer ||
            !boxParent ||
            !scrollViewTopLevel ||
            scrollViewTopLevel.get_parent() !== boxParent ||
            scrollViewTopLevel === pageIndicators
        ) {
            pageIndicators.clip_to_allocation = false;
            this.update();
            return;
        }

        this._originalParent = boxParent;
        this._originalIndex = boxParent
            .get_children()
            .indexOf(scrollViewTopLevel);
        this._originalScrollViewExpand = {
            x: scrollViewTopLevel.x_expand,
            y: scrollViewTopLevel.y_expand,
        };
        this._originalIndicatorsAlign = {
            x: pageIndicators.x_align,
            y: pageIndicators.y_align,
        };
        this._originalIndicatorsExpand = {
            x: pageIndicators.x_expand,
            y: pageIndicators.y_expand,
        };
        this._scrollViewTopLevel = scrollViewTopLevel;

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
        boxParent.insert_child_at_index(overlay, this._originalIndex);
        appDisplay._chOverlayContainer = overlay;

        pageIndicators.clip_to_allocation = false;
        this.update();
    }

    unmount() {
        const appDisplay = this._appDisplay;
        const overlay = appDisplay?._chOverlayContainer;
        const pageIndicators = appDisplay?._pageIndicators;

        this._destroyNavigation();

        if (overlay && this._originalParent) {
            const scrollViewTopLevel = this._scrollViewTopLevel;
            const parent = this._originalParent;
            const index = this._originalIndex ?? 0;

            if (scrollViewTopLevel?.get_parent() === overlay)
                overlay.remove_child(scrollViewTopLevel);
            if (pageIndicators?.get_parent() === overlay)
                overlay.remove_child(pageIndicators);

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
                if (this._originalIndicatorsAlign) {
                    pageIndicators.x_align = this._originalIndicatorsAlign.x;
                    pageIndicators.y_align = this._originalIndicatorsAlign.y;
                }
                if (this._originalIndicatorsExpand) {
                    pageIndicators.x_expand =
                        this._originalIndicatorsExpand.x;
                    pageIndicators.y_expand =
                        this._originalIndicatorsExpand.y;
                }
                pageIndicators.clear_constraints();
                pageIndicators.set_style(null);
                pageIndicators.clip_to_allocation = true;
                parent.insert_child_at_index(pageIndicators, index + 1);
            }

            overlay.destroy();
            delete appDisplay._chOverlayContainer;
        }

        this._originalParent = null;
        this._originalIndex = null;
        this._originalScrollViewExpand = null;
        this._originalIndicatorsAlign = null;
        this._originalIndicatorsExpand = null;
        this._scrollViewTopLevel = null;
    }

    update() {
        const pageIndicators = this._appDisplay?._pageIndicators;

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

        for (const indicator of pageIndicators.get_children()) {
            indicator.set_style(
                    `width: ${AppGridNavigation.PAGE_INDICATOR_SIZE}px !important; ` +
                    `height: ${AppGridNavigation.PAGE_INDICATOR_SIZE}px !important; ` +
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
                AppGridNavigation.PAGE_INDICATOR_SIZE,
                AppGridNavigation.PAGE_INDICATOR_SIZE,
            );

            const icon = indicator.get_children?.()?.[0];
            if (!icon) continue;

            const iconSize = AppGridNavigation.PAGE_INDICATOR_ICON_SIZE;
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
            icon.scale_x = 1;
            icon.scale_y = 1;
        }

        this._createNavigation();
        this._updateNavigationOrientation();
        this._enforceNavigationButtonsVisibility();
    }

    _patchPageIndicators(pageIndicators) {
        if (
            !this._originalUpdateIndicator &&
            typeof pageIndicators._updateIndicator === "function"
        ) {
            this._originalUpdateIndicator = pageIndicators._updateIndicator;
            const originalUpdateIndicator = this._originalUpdateIndicator;

            pageIndicators._updateIndicator = function (indicator, pageIndex) {
                originalUpdateIndicator.call(this, indicator, pageIndex);
                indicator?.child?.set_scale(1, 1);
            };
        }
    }

    _unpatchPageIndicators() {
        const pageIndicators = this._appDisplay?._pageIndicators;

        if (pageIndicators && this._originalUpdateIndicator) {
            pageIndicators._updateIndicator = this._originalUpdateIndicator;
            this._originalUpdateIndicator = null;
        }
    }

    _patchNavigationButtons() {
        const appDisplay = this._appDisplay;
        if (!appDisplay) return;

        const buttons = [appDisplay._prevPageArrow, appDisplay._nextPageArrow]
            .filter(Boolean);

        if (buttons.length !== 2) return;

        const parent = buttons[0].get_parent();
        if (!parent) return;

        this._navigationButtonsParent = parent;
        this._navigationButtonsOriginalIndices = buttons.map((button) =>
            parent.get_children().indexOf(button),
        );

        const syncOwner =
            typeof appDisplay._syncPageIndicatorsVisibility === "function"
                ? appDisplay
                : parent.layout_manager;
        const originalSyncVisibility =
            syncOwner?._syncPageIndicatorsVisibility;
        const originalSyncIndicators = syncOwner?._syncPageIndicators;

        if (
            typeof originalSyncVisibility === "function" ||
            typeof originalSyncIndicators === "function"
        ) {
            this._navigationButtonsSyncOwner = syncOwner;

            if (typeof originalSyncVisibility === "function") {
                this._originalSyncIndicatorsVisibility =
                    originalSyncVisibility;
                syncOwner._syncPageIndicatorsVisibility = () =>
                    this._enforceNavigationButtonsVisibility();
            }

            if (typeof originalSyncIndicators === "function") {
                this._originalSyncIndicators = originalSyncIndicators;
                const indicators = this;
                syncOwner._syncPageIndicators = function (...args) {
                    originalSyncIndicators.apply(this, args);
                    // Keep GNOME's page preview calculations and reset its
                    // translations on the independent navigation buttons.
                    indicators._lockNavigationButtons();
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
        for (const button of [this._previousButton, this._nextButton]) {
            if (!button) continue;
            button.remove_transition("opacity");
            button.translation_x = 0;
            button.translation_y = 0;
        }
        this._enforceNavigationButtonsVisibility();
    }

    _updateNavigationButtons() {
        const syncOwner = this._navigationButtonsSyncOwner;
        const originalSync = this._originalSyncIndicatorsVisibility;
        if (syncOwner && originalSync) originalSync.call(syncOwner, false);

        this._createNavigation();
        this._lockNavigationButtons();
        this.update();
    }

    _createNavigation() {
        const appDisplay = this._appDisplay;
        const overlay = appDisplay?._chOverlayContainer;
        const pageIndicators = appDisplay?._pageIndicators;
        const originalPrevious = appDisplay?._prevPageArrow;
        const originalNext = appDisplay?._nextPageArrow;

        if (
            !overlay ||
            !pageIndicators ||
            !originalPrevious ||
            !originalNext ||
            this._navigation
        ) {
            return;
        }

        const originalParent = originalPrevious.get_parent();
        if (!originalParent) return;

        this._navigationOriginalParent = originalParent;
        this._navigationOriginalIndex = originalParent
            .get_children()
            .indexOf(originalPrevious);

        if (originalPrevious.get_parent() === originalParent)
            originalParent.remove_child(originalPrevious);
        if (originalNext.get_parent() === originalParent)
            originalParent.remove_child(originalNext);
        if (pageIndicators.get_parent() === overlay)
            overlay.remove_child(pageIndicators);

        const vertical = this._isVertical();
        const previous = new St.Button({
            name: "ch-page-navigation-previous",
            style_class: "page-navigation-arrow",
            icon_name: vertical ? "go-up-symbolic" : "go-previous-symbolic",
            x_align: 0,
            y_align: 0,
        });
        const next = new St.Button({
            name: "ch-page-navigation-next",
            style_class: "page-navigation-arrow",
            icon_name: vertical ? "go-down-symbolic" : "go-next-symbolic",
            x_align: 0,
            y_align: 0,
        });

        previous.connect("clicked", () => {
            const currentPage = appDisplay?._grid?.currentPage ?? 0;
            if (typeof appDisplay?.goToPage === "function")
                appDisplay.goToPage(currentPage - 1);
        });
        next.connect("clicked", () => {
            const currentPage = appDisplay?._grid?.currentPage ?? 0;
            if (typeof appDisplay?.goToPage === "function")
                appDisplay.goToPage(currentPage + 1);
        });

        this._previousButton = previous;
        this._nextButton = next;

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
        navigation.add_child(previous);
        navigation.add_child(pageIndicators);
        navigation.add_child(next);
        overlay.add_child(navigation);

        this._navigation = navigation;
    }

    _updateNavigationOrientation() {
        const navigation = this._navigation;
        const overlay = this._appDisplay?._chOverlayContainer;
        if (!navigation || !overlay) return;

        const vertical = this._isVertical();
        const layout = navigation.layout_manager;
        layout.orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;
        layout.spacing = 0;
        this._updateNavigationButtonIcons(vertical);

        if (navigation.width <= 0 || navigation.height <= 0) return;

        if (vertical) {
            navigation.set_position(
                Math.round(
                    overlay.width -
                        navigation.width -
                        AppGridNavigation.PAGE_INDICATOR_EDGE_MARGIN,
                ),
                Math.round((overlay.height - navigation.height) / 2),
            );
        } else {
            navigation.set_position(
                Math.round((overlay.width - navigation.width) / 2),
                Math.round(
                    overlay.height -
                        navigation.height -
                        AppGridNavigation.PAGE_INDICATOR_BOTTOM_MARGIN,
                ),
            );
        }
        navigation.queue_relayout();
    }

    _updateNavigationButtonIcons(vertical) {
        if (this._previousButton) {
            this._previousButton.icon_name = vertical
                ? "go-up-symbolic"
                : "go-previous-symbolic";
        }
        if (this._nextButton) {
            this._nextButton.icon_name = vertical
                ? "go-down-symbolic"
                : "go-next-symbolic";
        }
    }

    _enforceNavigationButtonsVisibility() {
        const showButtons = this._settings.get_boolean(
            "show-app-grid-navigation-buttons",
        );
        for (const button of [this._previousButton, this._nextButton]) {
            if (!button) continue;
            button.remove_transition("opacity");
            button.visible = showButtons;
            button.opacity = showButtons ? 255 : 0;
            button.reactive = showButtons;
            button.can_focus = showButtons;
        }
    }

    _unpatchNavigationButtons() {
        if (this._navigationButtonsChangedId) {
            this._settings.disconnect(this._navigationButtonsChangedId);
            this._navigationButtonsChangedId = 0;
        }

        const syncOwner = this._navigationButtonsSyncOwner;
        if (
            syncOwner &&
            this._originalSyncIndicatorsVisibility &&
            syncOwner._syncPageIndicatorsVisibility !==
                this._originalSyncIndicatorsVisibility
        ) {
            syncOwner._syncPageIndicatorsVisibility =
                this._originalSyncIndicatorsVisibility;
        }
        if (
            syncOwner &&
            this._originalSyncIndicators &&
            syncOwner._syncPageIndicators !== this._originalSyncIndicators
        ) {
            syncOwner._syncPageIndicators = this._originalSyncIndicators;
        }
        this._navigationButtonsSyncOwner = null;
        this._originalSyncIndicatorsVisibility = null;
        this._originalSyncIndicators = null;
        this._navigationButtonsParent = null;
        this._navigationButtonsOriginalIndices = [];
    }

    _destroyNavigation() {
        const navigation = this._navigation;
        if (!navigation) return;

        const appDisplay = this._appDisplay;
        const pageIndicators = appDisplay?._pageIndicators;
        const originalPrevious = appDisplay?._prevPageArrow;
        const originalNext = appDisplay?._nextPageArrow;
        const originalParent = this._navigationOriginalParent;

        if (pageIndicators?.get_parent() === navigation)
            navigation.remove_child(pageIndicators);

        this._previousButton = null;
        this._nextButton = null;

        if (originalParent) {
            const index = this._navigationOriginalIndex ?? 0;
            if (
                originalPrevious &&
                originalPrevious.get_parent() !== originalParent
            ) {
                originalParent.insert_child_at_index(originalPrevious, index);
            }
            if (originalNext && originalNext.get_parent() !== originalParent) {
                originalParent.insert_child_at_index(
                    originalNext,
                    Math.min(index + 1, originalParent.get_n_children()),
                );
            }
        }

        navigation.destroy();
        this._navigation = null;
        this._navigationOriginalParent = null;
        this._navigationOriginalIndex = null;
    }

    _isVertical() {
        return (
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical"
        );
    }
}
