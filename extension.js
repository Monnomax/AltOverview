import Clutter from "gi://Clutter";
import Cogl from "gi://Cogl";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Shell from "gi://Shell";
import St from "gi://St";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Background from "resource:///org/gnome/shell/ui/background.js";
import { ControlsState } from "resource:///org/gnome/shell/ui/overviewControls.js";
import * as WorkspacesView from "resource:///org/gnome/shell/ui/workspacesView.js";
import { IconAnimator } from "./iconAnimations.js";

// Кастомний ефект насиченості кольорів (0.0 — відтінки сірого,
// 1.0 — без змін, >1.0 — підсилена насиченість).
const SaturationEffect = GObject.registerClass(
    class SaturationEffect extends Shell.GLSLEffect {
        _init(params) {
            super._init(params);
            this._saturation = 1.0;
            this._saturationLocation = this.get_uniform_location("saturation");
            this.set_uniform_float(this._saturationLocation, 1, [
                this._saturation,
            ]);
        }

        vfunc_build_pipeline() {
            const declarations = `
                uniform float saturation;
            `;
            const code = `
                float _luma = dot(cogl_color_out.rgb, vec3(0.299, 0.587, 0.114));
                cogl_color_out.rgb = clamp(
                    mix(vec3(_luma), cogl_color_out.rgb, saturation),
                    0.0, 1.0
                );
            `;
            this.add_glsl_snippet(
                Cogl.SnippetHook.FRAGMENT,
                declarations,
                code,
                false,
            );
        }

        setSaturation(value) {
            if (this._saturation === value) return;
            this._saturation = value;
            this.set_uniform_float(this._saturationLocation, 1, [value]);
            this.queue_repaint();
        }

        forceRepaint() {
            this.queue_repaint();
        }
    },
);

// Кастомний ефект зернистості (накладає статичний шум поверх
// зображення; obчислюється за координатами текстури, тож лишається
// різким навіть якщо застосовано розмиття перед ним).
const GrainEffect = GObject.registerClass(
    class GrainEffect extends Shell.GLSLEffect {
        _init(params) {
            super._init(params);
            this._amount = 0.0;
            this._amountLocation = this.get_uniform_location("grain_amount");
            this._actor = null;
            this.set_uniform_float(this._amountLocation, 1, [this._amount]);
        }

        vfunc_build_pipeline() {
            const declarations = `
                uniform float grain_amount;

                float _grain_rand(vec2 co)
{
    co = fract(co * vec2(0.1031, 0.1030));
    co += dot(co, co.yx + 33.33);
    return fract((co.x + co.y) * co.x);
}
            `;
            const code = `
    vec2 _grainPixel = gl_FragCoord.xy;

    float _grainNoise =
        _grain_rand(_grainPixel) - 0.5;

    cogl_color_out.rgb = clamp(
        cogl_color_out.rgb +
        _grainNoise * grain_amount,
        0.0,
        1.0
    );
`;
            this.add_glsl_snippet(
                Cogl.SnippetHook.FRAGMENT,
                declarations,
                code,
                false,
            );
        }

        // percent: 0-100 зі схеми налаштувань
        setAmount(percent) {
            const value = (percent / 100) * 0.08;
            if (this._amount === value) return;
            this._amount = value;
            this.set_uniform_float(this._amountLocation, 1, [value]);
            this.queue_repaint();
            this._actor?.queue_redraw();
        }

        forceRepaint() {
            this.queue_repaint();
            this._actor?.queue_redraw();
        }

        setActor(actor) {
            this._actor = actor;
        }
    },
);

const MonitorBackground = GObject.registerClass(
    class MonitorBackground extends St.Widget {
        _init(monitorIndex) {
            super._init({
                layout_manager: new Clutter.BinLayout(),
                reactive: false,
            });

            this._monitorIndex = monitorIndex;

            this._brightnessEffect = new Clutter.BrightnessContrastEffect();
            this._saturationEffect = new SaturationEffect();
            this._blurEffect = new Shell.BlurEffect({
                mode: Shell.BlurMode.ACTOR,
                brightness: 1.0,
            });
            this._grainEffect = new GrainEffect();

            this._bgManager = new Background.BackgroundManager({
                container: this,
                layoutManager: Main.layoutManager,
                monitorIndex,
                controlPosition: false,
            });

            this.add_effect_with_name("overview-bg-grain", this._grainEffect);

            this._changedId = this._bgManager.connect("changed", () =>
                this._attachEffects(),
            );

            this._attachEffects();
            this._relayout();
        }

        _attachEffects() {
            const actor = this._bgManager.backgroundActor;
            if (!actor) return;

            if (actor.get_effect("overview-bg-brightness") === null)
                actor.add_effect_with_name(
                    "overview-bg-brightness",
                    this._brightnessEffect,
                );
            if (actor.get_effect("overview-bg-saturation") === null)
                actor.add_effect_with_name(
                    "overview-bg-saturation",
                    this._saturationEffect,
                );
            if (actor.get_effect("overview-bg-blur") === null)
                actor.add_effect_with_name(
                    "overview-bg-blur",
                    this._blurEffect,
                );
            this._brightnessEffect.queue_repaint();
            this._saturationEffect.forceRepaint();
            this._blurEffect.queue_repaint();
            this._grainEffect.forceRepaint();
            actor.queue_redraw();
        }

        _relayout() {
            const monitor = Main.layoutManager.monitors[this._monitorIndex];
            if (
                !monitor ||
                ![monitor.x, monitor.y, monitor.width, monitor.height].every(
                    (value) => Number.isFinite(value),
                ) ||
                monitor.width <= 0 ||
                monitor.height <= 0
            )
                return;
            this.set_position(monitor.x, monitor.y);
            this.set_size(monitor.width, monitor.height);
        }

        setBrightness(percent) {
            const value = Math.min(1, Math.max(-1, percent / 100));
            this._brightnessEffect.set_brightness(value);
            this._brightnessEffect.queue_repaint();
        }

        setSaturation(value) {
            this._saturationEffect.setSaturation(value);
        }

        setBlurRadius(percent) {
            this._blurEffect.radius = percent;
            // Shell.BlurEffect не завжди перемальовується сам по собі
            // при зміні "radius" (відомий нюанс: https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2857,
            // з тієї ж причини "Blur my Shell" примусово викликає
            // queue_repaint() після зміни параметрів розмиття) —
            // тож форсуємо перемальовку явно, інакше нове значення
            // візуально застосується лише після наступного
            // "природного" repaint (зміна розміру, наведення тощо).
            this._blurEffect.queue_repaint();
        }

        setGrain(percent) {
            this._grainEffect.setAmount(percent);
        }

        _onDestroy() {
            if (this._changedId) {
                this._bgManager.disconnect(this._changedId);
                this._changedId = 0;
            }
            this._bgManager.destroy();
        }

        vfunc_destroy() {
            this._onDestroy();
            super.vfunc_destroy();
        }
    },
);

export default class OverviewBackgroundExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._backgrounds = [];
        this._monitorRebuildSourceId = 0;

        this._container = new St.Widget({
            name: "overview-background-container",
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
        });

        Main.layoutManager.overviewGroup.insert_child_at_index(
            this._container,
            0,
        );

        this._monitorsChangedId = Main.layoutManager.connect(
            "monitors-changed",
            () => this._scheduleMonitorRebuild(),
        );
        this._settingsChangedId = this._settings.connect("changed", () =>
            this._onSettingsChanged(),
        );
        this._appGridShowNamesChangedId = this._settings.connect(
            "changed::app-grid-names-visibility",
            () => this._updateAppGridNamesVisibility(),
        );
        this._searchEntry = Main.overview.searchEntry;

        this._controls = Main.overview._overview._controls;
        this._layoutManager = this._controls?.layout_manager ?? null;
        this._appDisplay = this._controls?._appDisplay ?? null;
        this._workspacesDisplay = this._controls?._workspacesDisplay ?? null;
        this._workspacesView =
            this._workspacesDisplay?._workspacesViews?.[0] ?? null;
        this._updateWorkspacesOrientation();

        if (this._appDisplay) this._patchVerticalAppGrid();

        this._scheduleMonitorRebuild();
        this._patchControlsLayout();
        this._patchAppGrid();

        this._initScrollHandlers();
        this._onSettingsChanged();
        this._updateAppGridNamesVisibility();
    }

    _patchVerticalWorkspaces() {
        const view = this._workspacesView;
        if (!view || view._verticalPatched) return;

        this._origUpdateWorkspaces = view._updateWorkspaces;
        this._origWorkspacesAllocate = view.vfunc_allocate;
        const extension = this;

        view._updateWorkspaces = function () {
            extension._origUpdateWorkspaces.call(this);
            extension._applyVerticalWorkspaceTranslations();
        };

        view.vfunc_allocate = function (box) {
            extension._origWorkspacesAllocate.call(this, box);
            extension._applyVerticalWorkspaceTranslations();
        };

        view._verticalPatched = true;

        const display = this._workspacesDisplay;
        if (display && !display._verticalPatched) {
            this._origUpdateTrackerOrientation =
                display._updateTrackerOrientation;
            display._updateTrackerOrientation = function () {
                extension._origUpdateTrackerOrientation.call(this);
                if (this._swipeTracker)
                    this._swipeTracker.orientation =
                        Clutter.Orientation.VERTICAL;
            };
            display._verticalPatched = true;
            display._updateTrackerOrientation();
        }
    }

    _applyVerticalWorkspaceTranslations() {
        const view = this._workspacesView;
        if (!view?._workspaces?.length) return;

        const active = global.workspace_manager.get_active_workspace_index();
        const activeWorkspace = view._workspaces[active];
        if (!activeWorkspace) return;

        view._workspaces.forEach((ws) => {
            ws.translation_x = 0;
            ws.translation_y = 0;
        });

        const spacing =
            view._workspaces.length > 1
                ? Math.max(
                      0,
                      Math.abs(view._workspaces[1].x - view._workspaces[0].x) -
                          activeWorkspace.width,
                  )
                : 0;
        const activeX = activeWorkspace.x;
        const activeY = activeWorkspace.y;
        const height = activeWorkspace.height;
        const current = view._scrollAdjustment?.value ?? active;

        view._workspaces.forEach((ws, index) => {
            ws.translation_x = activeX - ws.x;
            ws.translation_y =
                activeY + (index - current) * (height + spacing) - ws.y;
        });
    }

    _unpatchVerticalWorkspaces() {
        const view = this._workspacesView;
        if (!view?._verticalPatched || !this._origUpdateWorkspaces) return;

        view._updateWorkspaces = this._origUpdateWorkspaces;
        view.vfunc_allocate = this._origWorkspacesAllocate;
        delete view._verticalPatched;
        this._origUpdateWorkspaces = null;
        this._origWorkspacesAllocate = null;
        view._updateWorkspaces();
        view._workspaces?.forEach((ws) => {
            ws.translation_x = 0;
            ws.translation_y = 0;
        });

        const display = this._workspacesDisplay;
        if (display?._verticalPatched) {
            display._updateTrackerOrientation =
                this._origUpdateTrackerOrientation;
            delete display._verticalPatched;
            this._origUpdateTrackerOrientation = null;
            display._updateTrackerOrientation();
        }
    }

    _updateWorkspacesOrientation() {
        if (!this._workspacesView) return;

        const vertical =
            this._settings.get_string("workspaces-scroll-direction") ===
            "vertical";
        if (vertical) this._patchVerticalWorkspaces();
        else this._unpatchVerticalWorkspaces();

        this._workspacesView._updateWorkspaces();
        this._workspacesView.queue_relayout();
    }

    _patchVerticalAppGrid() {
        const grid = this._appDisplay?._grid;
        const scrollView = this._appDisplay?._scrollView;
        if (!grid || !scrollView || grid._verticalPatched) return;

        this._origAppGridOrientation = grid.layout_manager.orientation;
        this._origAppDisplayOrientation = this._appDisplay._orientation;
        this._origSwipeOrientation =
            this._appDisplay._swipeTracker?.orientation;
        this._origAppGridAdjustment = this._appDisplay._adjustment;
        this._origHScrollbarPolicy = scrollView.hscrollbar_policy;
        this._origVScrollbarPolicy = scrollView.vscrollbar_policy;

        grid._verticalPatched = true;
        this._updateAppGridOrientation();
    }

    _updateAppGridOrientation() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;
        const scrollView = appDisplay?._scrollView;
        if (!grid?._verticalPatched || !scrollView) return;

        const vertical =
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical";
        const orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : this._origAppGridOrientation;

        grid.layout_manager.orientation = orientation;
        appDisplay._orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : this._origAppDisplayOrientation;
        if (appDisplay._swipeTracker)
            appDisplay._swipeTracker.orientation = vertical
                ? Clutter.Orientation.VERTICAL
                : this._origSwipeOrientation;
        appDisplay._adjustment = vertical
            ? scrollView.vadjustment
            : this._origAppGridAdjustment;

        scrollView.hscrollbar_policy = vertical
            ? St.PolicyType.NEVER
            : this._origHScrollbarPolicy;
        scrollView.vscrollbar_policy = vertical
            ? St.PolicyType.EXTERNAL
            : this._origVScrollbarPolicy;

        const nPages =
            typeof grid.nPages === "function"
                ? grid.nPages()
                : (grid.nPages ?? 0);
        if (nPages > 0) {
            const targetPage = Math.min(grid.currentPage ?? 0, nPages - 1);
            grid.goToPage(targetPage, false);
        }
        grid.queue_relayout();
    }

    // Відстань між нижнім краєм монітора та нижнім краєм індикаторів (в px).
    static PAGE_INDICATOR_BOTTOM_MARGIN = 20;

    // Плавно масштабує саму іконку (item.icon.icon — St.Icon всередині
    // BaseIcon) при наведенні/відведенні або натисканні/відпусканні,
    // використовуючи криву, тривалості та масштаб з налаштувань
    // ("Анімація іконок" / "Масштабування іконок" у "Сітка програм").
    // kind: "hover" | "press".
    _animateIconInteraction(item, kind) {
        const icon = item?.icon?.icon;
        if (!icon || !this._settings) return;

        const active = kind === "press" ? item.pressed : item.hover;
        const prefix =
            kind === "press" ? "app-grid-icon-press" : "app-grid-icon-hover";
        const curveName = this._settings.get_string(`${prefix}-curve`);

        IconAnimator.scale(icon, {
            active,
            targetScale: this._settings.get_double(`${prefix}-scale`),
            curveName,
            inDuration: this._getCurveDuration(
                `${prefix}-in-durations`,
                curveName,
            ),
            outDuration: this._getCurveDuration(
                `${prefix}-out-durations`,
                curveName,
            ),
        });
    }

    // Читає тривалість, збережену саме для curveName у dict-налаштуванні
    // (тип "a{si}", записується з prefs.js окремо на кожну криву). Якщо
    // для цієї кривої ще нічого не збережено — фолбек 200 мс (той самий
    // default, що заданий у схемі для порожнього словника).
    _getCurveDuration(key, curveName) {
        const dict = this._settings.get_value(key).deep_unpack();
        return curveName in dict ? dict[curveName] : 200;
    }

    _updateAppGridPageIndicators(pageIndicators) {
        if (!pageIndicators) return;

        pageIndicators.visible = true;
        pageIndicators.get_children().forEach((indicator) => {
            indicator.add_style_class_name("page-indicator");
            indicator.visible = true;
        });
    }

    _patchAppGrid() {
        if (!this._appDisplay || !this._appDisplay._grid) return;

        const appDisplay = this._appDisplay;
        const scrollView = appDisplay._scrollView;
        const pageIndicators = appDisplay._pageIndicators;

        // Замість того, щоб перевизначати vfunc_allocate/vfunc_get_preferred_height
        // конкретного актора (крихкий хак, залежний від внутрішньої логіки
        // GNOME), переносимо _scrollView та _pageIndicators у спільний
        // St.Widget з Clutter.BinLayout. BinLayout за своєю природою
        // накладає дітей одна на одну (а не розташовує послідовно, як
        // BoxLayout), тож індикатори автоматично опиняються поверх сітки,
        // без резервування для них окремого місця в лейауті.
        // Замість того, щоб перевизначати vfunc_allocate/vfunc_get_preferred_height
        // конкретного актора (крихкий хак, залежний від внутрішньої логіки
        // GNOME), переносимо обгортку _scrollView та _pageIndicators у
        // спільний St.Widget з Clutter.BinLayout. BinLayout за своєю
        // природою накладає дітей одна на одну (а не розташовує послідовно,
        // як BoxLayout), тож індикатори автоматично опиняються поверх
        // сітки, без резервування для них окремого місця в лейауті.
        //
        // scrollView.get_parent() !== pageIndicators.get_parent() у деяких
        // версіях GNOME (scrollView додатково загорнутий у проміжний
        // StWidget) — тому шукаємо не сам scrollView, а того з його
        // предків, який є ПРЯМОЮ дитиною спільного з pageIndicators
        // батька (boxParent), і переносимо в overlay саме його.
        const boxParent = pageIndicators?.get_parent() ?? null;
        let scrollViewTopLevel = scrollView;
        while (
            scrollViewTopLevel &&
            boxParent &&
            scrollViewTopLevel.get_parent() !== boxParent
        ) {
            scrollViewTopLevel = scrollViewTopLevel.get_parent();
        }

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

            // Додається другим — отже, малюється поверх scrollView/сітки.
            // x_align/y_align тут НЕ використовуємо для позиціювання —
            // виявилось, що BinLayout у цій версії Clutter/GJS їх не
            // враховує так, як очікувалось. Пряме set_position() зі
            // слухача notify::allocation теж не підійшло — виклик, що сам
            // запускає relayout, зсередини обробника сигналу про щойно
            // завершений relayout, спричиняв reentrancy (NaN allocation).
            // Clutter.Constraint рахується як частина ТОГО Ж самого
            // циклу allocate(), без повторного входу — тому саме тут
            // це безпечно.
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

            const bottomMargin =
                OverviewBackgroundExtension.PAGE_INDICATOR_BOTTOM_MARGIN;
            // AlignConstraint(factor: 1.0) притискає впритул до нижнього
            // краю overlay (0px). Відступ додаємо звичайним CSS-margin —
            // на відміну від x_align/y_align, margin у St застосовується
            // окремим кроком у власному allocate() St.Widget'а, ПІСЛЯ
            // того, як constraint вже порахував базову позицію.
            pageIndicators.set_style(
                `margin-bottom: ${bottomMargin}px !important;`,
            );
        }

        if (pageIndicators) {
            pageIndicators.clip_to_allocation = false;
            this._updateAppGridPageIndicators(pageIndicators);
        }

        const extension = this;
        const gridActor = this._appDisplay._grid;

        // Використовуємо !important для гарантованого перекриття системної теми
        gridActor.set_style(
            "margin-bottom: 0px !important; margin-top: 0px !important; padding-bottom: 0px !important;",
        );
        gridActor.y_expand = true;

        if (this._appDisplay._scrollView) {
            this._appDisplay._scrollView.set_style(
                "margin-bottom: 0px !important; padding-bottom: 0px !important;",
            );
            this._appDisplay._scrollView.y_expand = true;
        }

        // Знімаємо можливі відступи з головного контейнера AppDisplay
        this._appDisplay.set_style(
            "margin-bottom: 0px !important; padding-bottom: 0px !important;",
        );

        const layoutManager = gridActor.layout_manager;
        if (layoutManager._customGridPatched) return;

        this._originalAdaptToSize = layoutManager.adaptToSize;

        layoutManager.adaptToSize = function (width, height) {
            extension._originalAdaptToSize.call(this, width, height);
            extension._updateAppGridPageIndicators(appDisplay._pageIndicators);

            // Жорстко обнуляємо розраховані GNOME відступи сторінки
            if (this.page_padding) {
                this.page_padding.bottom = 0;
                this.page_padding.top = 0;
            }

            const cols = extension._settings?.get_int("app-grid-columns") ?? 6;
            const rows = extension._settings?.get_int("app-grid-rows") ?? 5;

            this.columns_per_page = cols;
            this.rows_per_page = rows;

            const padding = this.page_padding;
            const availWidth = width - padding.left - padding.right;
            const availHeight = height - padding.top - padding.bottom;

            if (
                ![width, height, availWidth, availHeight].every((value) =>
                    Number.isFinite(value),
                ) ||
                availWidth <= 0 ||
                availHeight <= 0 ||
                cols <= 0 ||
                rows <= 0
            )
                return;

            if (gridActor.get_n_children() > 0) {
                // Розмір іконки застосовуємо ДО виміру preferred size —
                // інакше цей вимір (нижче) використав би розмір іконки
                // ще з попереднього relayout'у, і зміна налаштування
                // "Розмір" відображалась би із затримкою в один цикл.
                for (let i = 0; i < gridActor.get_n_children(); i++)
                    extension._applyIconSize(gridActor.get_child_at_index(i));

                const child = gridActor.get_child_at_index(0);
                const [minW, natW] = child.get_preferred_width(-1);
                const [minH, natH] = child.get_preferred_height(natW);

                const childW = natW || 100;
                const childH = natH || 120;

                const minSpacing = 10;
                const slotW = (availWidth - (cols - 1) * minSpacing) / cols;
                const slotH = (availHeight - (rows - 1) * minSpacing) / rows;

                let scale = 1.0;
                if (childW > slotW || childH > slotH) {
                    const scaleX = slotW / childW;
                    const scaleY = slotH / childH;
                    scale = Math.min(scaleX, scaleY);
                }

                const namesMode =
                    extension._settings?.get_string(
                        "app-grid-names-visibility",
                    ) ?? "always";

                for (let i = 0; i < gridActor.get_n_children(); i++) {
                    let item = gridActor.get_child_at_index(i);
                    item.set_pivot_point(0.5, 0.5);
                    item.set_scale(scale, scale);

                    extension._applyNameVisibilityMode(item, namesMode);
                }
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
                // Індикатори йдуть одразу після сітки, як у стандартному GNOME
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

        if (this._appDisplay) {
            this._appDisplay.set_style(null);

            if (this._appDisplay._scrollView) {
                this._appDisplay._scrollView.set_style(null);
            }

            if (this._appDisplay._grid) {
                const gridActor = this._appDisplay._grid;
                gridActor.set_style(null);

                const layoutManager = gridActor.layout_manager;
                if (layoutManager && this._originalAdaptToSize) {
                    layoutManager.adaptToSize = this._originalAdaptToSize;
                    delete layoutManager._customGridPatched;

                    for (let i = 0; i < gridActor.get_n_children(); i++) {
                        let item = gridActor.get_child_at_index(i);
                        item.set_scale(1.0, 1.0);
                    }

                    gridActor.queue_relayout();
                }
            }
        }
        this._originalAdaptToSize = null;
    }

    _initScrollHandlers() {
        this._lastScrollTime = 0;

        if (this._appDisplay) {
            this._appCapturedId = this._appDisplay.connect(
                "captured-event",
                (actor, event) => {
                    if (event.type() !== Clutter.EventType.SCROLL)
                        return Clutter.EVENT_PROPAGATE;
                    // Дозволяємо системі обробити скрол, якщо відкрита папка з додатками
                    if (this._appDisplay._folderOpen)
                        return Clutter.EVENT_PROPAGATE;

                    if (this._processScroll(event, "app-grid"))
                        return Clutter.EVENT_STOP;
                    return Clutter.EVENT_PROPAGATE;
                },
            );
        }

        if (this._workspacesDisplay) {
            this._wsCapturedId = this._workspacesDisplay.connect(
                "captured-event",
                (actor, event) => {
                    if (event.type() !== Clutter.EventType.SCROLL)
                        return Clutter.EVENT_PROPAGATE;

                    if (this._processScroll(event, "workspaces"))
                        return Clutter.EVENT_STOP;
                    return Clutter.EVENT_PROPAGATE;
                },
            );
        }
    }

    _processScroll(event, type) {
        const direction = this._settings.get_string(type + "-scroll-direction");
        if (direction === "default") return false; // GNOME відпрацює самостійно

        const step = this._getScrollStep(event, direction);

        if (step === 0) return false;

        const now = GLib.get_monotonic_time();
        if (now - this._lastScrollTime < 250000) return true; // Кулдаун від подвійних спрацювань
        this._lastScrollTime = now;

        if (type === "app-grid") {
            this._goToAppGridPage(step);
        } else {
            this._switchWorkspace(step);
        }

        return true;
    }

    // Логіка на кшталт V-Shell: надійно обробляємо як звичайний скрол,
    // так і SMOOTH-події з нульовою дельтою на першому кадрі.
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
            // Дозволяємо вертикальному коліщатку перемикати й у horizontal-режимі.
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

    _goToAppGridPage(step) {
        if (!this._appDisplay || !this._appDisplay._grid) return;
        const grid = this._appDisplay._grid;

        const currentPage = grid.currentPage ?? 0;
        const nPages =
            typeof grid.nPages === "function"
                ? grid.nPages()
                : (grid.nPages ?? 1);

        if (nPages <= 0) return;

        const newPage = Math.min(Math.max(currentPage + step, 0), nPages - 1);
        if (
            newPage !== currentPage &&
            typeof this._appDisplay.goToPage === "function"
        ) {
            this._appDisplay.goToPage(newPage);
        }
    }

    _patchControlsLayout() {
        if (!this._layoutManager || this._layoutManager._chAppGridPatched)
            return;

        this._originalComputeWorkspacesBoxForState =
            this._layoutManager._computeWorkspacesBoxForState;
        this._originalGetAppDisplayBoxForState =
            this._layoutManager._getAppDisplayBoxForState;

        const extension = this;
        this._layoutManager._computeWorkspacesBoxForState = function (
            state,
            ...args
        ) {
            const workspaceBox =
                extension._originalComputeWorkspacesBoxForState.call(
                    this,
                    state,
                    ...args,
                );

            // Обнуляємо box лише для стану APP_GRID — це "проглядання"
            // мініатюр позаду сітки програм. WINDOW_PICKER (основний вигляд
            // Overview) не займаємо: там WorkspaceView — той самий актор,
            // і його властивість visible не залежить від стану, тож ховати
            // через неї можна лише завжди-і-всюди, а не вибірково.
            if (
                state === ControlsState.APP_GRID &&
                extension._shouldHideWorkspacesPeek()
            ) {
                // Зберігаємо ненульовий box: WorkspaceBackground може
                // отримати некоректну allocation при set_size(0, 0).
                // Переміщення валідного box за межі робочої області дає
                // той самий візуальний результат без NaN/від'ємних розмірів.
                const workAreaBox = args.find(
                    (arg) =>
                        arg &&
                        typeof arg.get_width === "function" &&
                        typeof arg.get_height === "function" &&
                        typeof arg.x1 === "number" &&
                        typeof arg.y1 === "number",
                );
                const offscreenX = workAreaBox?.x2 ?? 100000;
                const offscreenY = workAreaBox?.y2 ?? 100000;
                workspaceBox.set_origin(offscreenX + 1000, offscreenY + 1000);
            }

            const size = extension._settings?.get_int("workspace-size") ?? 100;
            if (state !== ControlsState.HIDDEN && size !== 100) {
                const scale = size / 100;
                const width = workspaceBox.get_width();
                const height = workspaceBox.get_height();
                const scaledWidth = width * scale;
                const scaledHeight = height * scale;

                workspaceBox.set_origin(
                    workspaceBox.x1 + (width - scaledWidth) / 2,
                    workspaceBox.y1 + (height - scaledHeight) / 2,
                );
                workspaceBox.set_size(scaledWidth, scaledHeight);
            }

            const workAreaBox = args.find(
                (arg) =>
                    arg &&
                    typeof arg.get_width === "function" &&
                    typeof arg.get_height === "function" &&
                    typeof arg.x1 === "number" &&
                    typeof arg.y1 === "number",
            );
            if (
                state === ControlsState.WINDOW_PICKER &&
                extension._shouldCenterWorkspace() &&
                workAreaBox
            ) {
                workspaceBox.set_origin(
                    workAreaBox.x1 +
                        (workAreaBox.get_width() - workspaceBox.get_width()) /
                            2,
                    workAreaBox.y1 +
                        (workAreaBox.get_height() - workspaceBox.get_height()) /
                            2,
                );
            }

            return workspaceBox;
        };
        this._layoutManager._getAppDisplayBoxForState = function (
            state,
            ...args
        ) {
            const appDisplayBox =
                extension._originalGetAppDisplayBoxForState.call(
                    this,
                    state,
                    ...args,
                );

            if (state === ControlsState.APP_GRID) {
                // Повернено до 100% ширини та висоти
                appDisplayBox.set_origin(...this._workAreaBox.get_origin());
                appDisplayBox.set_size(...this._workAreaBox.get_size());
            }

            return appDisplayBox;
        };
        this._layoutManager._chAppGridPatched = true;
    }

    _unpatchControlsLayout() {
        if (this._layoutManager && this._originalComputeWorkspacesBoxForState) {
            this._layoutManager._computeWorkspacesBoxForState =
                this._originalComputeWorkspacesBoxForState;
            this._layoutManager._getAppDisplayBoxForState =
                this._originalGetAppDisplayBoxForState;
            delete this._layoutManager._chAppGridPatched;
        }
        this._originalComputeWorkspacesBoxForState = null;
        this._originalGetAppDisplayBoxForState = null;
    }

    _shouldHideWorkspacesPeek() {
        return this._settings
            ? !this._settings.get_boolean("show-workspaces-thumbnails")
            : false;
    }

    _shouldCenterWorkspace() {
        return (
            this._settings &&
            !this._settings.get_boolean("show-search-entry") &&
            !this._settings.get_boolean("show-workspaces-thumbnails")
        );
    }

    // Приховування реалізоване виключно через box у
    // _computeWorkspacesBoxForState (лише для стану APP_GRID) — саме тому
    // тут НЕ чіпаємо .visible на _workspacesView: ця властивість дійсна для
    // актора в цілому, незалежно від поточного стану Overview, тож пряме
    // приховування зламало б WorkspaceView і в WINDOW_PICKER також.
    _updateWorkspacesDisplay() {
        this._layoutManager?.layout_changed();
    }

    _updateSearchEntry() {
        if (!this._searchEntry) return;

        const show = this._settings.get_boolean("show-search-entry");
        this._searchEntry.visible = show;

        if (show) this._searchEntry.set_height(-1);
        else this._searchEntry.set_height(0);
    }

    // Показує/приховує підписи з назвами програм під іконками в сітці,
    // залежно від режиму "app-grid-names-visibility":
    //  - "always" — підпис видно завжди;
    //  - "never"  — підпис прихований завжди;
    //  - "hover"  — підпис з'являється лише під час наведення вказівника
    //    (через властивість St.Widget.hover, яку St.Button автоматично
    //    оновлює завдяки track_hover, і сигнал "notify::hover").
    _updateAppGridNamesVisibility() {
        if (!this._appDisplay || !this._appDisplay._grid) return;

        const mode = this._settings.get_string("app-grid-names-visibility");
        const gridActor = this._appDisplay._grid;

        for (let i = 0; i < gridActor.get_n_children(); i++) {
            this._applyNameVisibilityMode(
                gridActor.get_child_at_index(i),
                mode,
            );
        }
    }

    // Застосовує режим відображення підпису до одного елемента сітки
    // (застосунок або папка — обидва класи мають публічну властивість
    // icon.label, St.Label з BaseIcon) і гарантує, що обробник наведення
    // під'єднаний рівно один раз.
    _applyNameVisibilityMode(item, mode) {
        const label = item?.icon?.label;
        if (!label) return;

        this._ensureNameHoverHandler(item);

        if (mode === "never") label.visible = false;
        else if (mode === "hover") label.visible = item.hover ?? false;
        else label.visible = true; // "always" і фолбек для невідомих значень
    }

    // Незважаючи на назву методу виклику (_applyNameVisibilityMode),
    // тут же під'єднуються обробники bounce-анімації іконки при
    // наведенні (notify::hover) і натисканні (notify::pressed) — обидва
    // мають бути під'єднані рівно один раз на кожен grid-елемент, тож
    // логічно тримати їх поруч із уже наявною перевіркою-guard'ом.
    // Розмір самої іконки (app-grid-icon-size) сюди навмисно не входить:
    // застосовується окремо, у _applyIconSize(), який викликається на
    // КОЖЕН relayout (а не один раз), щоб реагувати на зміну
    // налаштування наживо, поки Overview відкрито.
    _ensureNameHoverHandler(item) {
        if (item._chHoverHandlerId) return;

        const extension = this;
        item.track_hover = true;
        item._chHoverHandlerId = item.connect("notify::hover", () => {
            if (
                extension._settings?.get_string("app-grid-names-visibility") ===
                "hover"
            ) {
                const label = item.icon?.label;
                if (label) label.visible = item.hover;
            }
            extension._animateIconInteraction(item, "hover");
        });
        item.connect("destroy", () => {
            item._chHoverHandlerId = 0;
        });

        // St.Button (яким є AppIcon) має власну властивість "pressed",
        // яка перемикається під час утримання кнопки миші — так само,
        // як "hover" вище.
        item._chPressHandlerId = item.connect("notify::pressed", () => {
            extension._animateIconInteraction(item, "press");
        });
        item.connect("destroy", () => {
            item._chPressHandlerId = 0;
        });
    }

    // У скільки разів текстура іконки растеризується більшою за її
    // видимий розмір у стані спокою. При bounce-масштабуванні на
    // наведення/натискання GPU тоді апскейлить із запасом роздільної
    // здатності, а не 1:1-текстуру — це зберігає чіткість малюнка на
    // збільшеній іконці, а не просто розтягує вже готовий растр.
    static ICON_TEXTURE_OVERSAMPLE = 1.5;

    // Значення в px для кожного з 4 пунктів випадаючого меню "Розмір"
    // (app-grid-icon-size) у групі "Розмір іконок" — має відповідати
    // APP_GRID_ICON_SIZE у prefs.js.
    static ICON_SIZE_PX = {
        small: 48,
        medium: 64,
        large: 80,
        "extra-large": 96,
    };

    _getConfiguredIconSize() {
        const key =
            this._settings?.get_string("app-grid-icon-size") ?? "medium";
        return OverviewBackgroundExtension.ICON_SIZE_PX[key] ?? 64;
    }

    // Застосовує обраний у налаштуваннях розмір іконки (app-grid-icon-size)
    // до одного grid-елемента, з тим самим оверсемплінгом текстури, що й
    // раніше. На відміну від _ensureNameHoverHandler, це НЕ одноразова дія:
    // викликається з adaptToSize на кожен relayout, тож завжди перераховує
    // з поточного значення налаштування (а не з icon.icon_size, який після
    // попереднього виклику вже містить оверсемпленний розмір) — інакше
    // повторний виклик множив би розмір на 1.5 щоразу.
    _applyIconSize(item) {
        const icon = item?.icon?.icon;
        if (!icon || icon.is_destroyed?.()) return;

        // Зберігаємо оригінальний (виставлений GNOME) icon_size один раз,
        // щоб мати змогу коректно відновити його в disable().
        if (icon._chOriginalIconSize === undefined)
            icon._chOriginalIconSize = icon.icon_size;

        const displaySize = this._getConfiguredIconSize();

        // Просимо St.Icon згенерувати текстуру за більшим розміром...
        icon.icon_size = Math.round(
            displaySize * OverviewBackgroundExtension.ICON_TEXTURE_OVERSAMPLE,
        );
        // ...але фіксуємо сам actor на обраному видимому розмірі, щоб
        // верстка (відступи в BaseIcon) залежала лише від нього —
        // set_size() перевизначає preferred size, тож батьківський
        // layout бачить рівно displaySize, а не оверсемпленний розмір.
        icon.set_size(displaySize, displaySize);
    }

    _rebuildMonitors() {
        const monitors = Main.layoutManager.monitors;
        if (
            !monitors?.length ||
            monitors.some(
                (monitor) =>
                    ![
                        monitor.x,
                        monitor.y,
                        monitor.width,
                        monitor.height,
                    ].every((value) => Number.isFinite(value)) ||
                    monitor.width <= 0 ||
                    monitor.height <= 0,
            )
        )
            return;

        this._backgrounds.forEach((bg) => bg.destroy());
        this._backgrounds = [];

        this._container.destroy_all_children();

        for (let i = 0; i < monitors.length; i++) {
            const bg = new MonitorBackground(i);
            this._container.add_child(bg);
            this._backgrounds.push(bg);
        }

        this._applyValuesToAll();
    }

    _scheduleMonitorRebuild() {
        if (this._monitorRebuildSourceId) return;

        this._monitorRebuildSourceId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT,
            () => {
                this._monitorRebuildSourceId = 0;
                if (this._container) this._rebuildMonitors();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _onSettingsChanged() {
        this._container.visible = this._settings.get_boolean("enabled");
        this._applyValuesToAll();
        this._updateSearchEntry();
        this._updateWorkspacesDisplay();
        this._updateWorkspacesOrientation();

        if (this._appDisplay && this._appDisplay._grid) {
            this._updateAppGridOrientation();
            this._appDisplay._grid.queue_relayout();
        }
    }

    _applyValuesToAll() {
        const brightness = this._settings.get_int("brightness");
        const saturation = this._settings.get_double("saturation");
        const blur = this._settings.get_int("blur");
        const grain = this._settings.get_int("grain");
        for (const bg of this._backgrounds) {
            bg.setBrightness(brightness);
            bg.setSaturation(saturation);
            bg.setBlurRadius(blur);
            bg.setGrain(grain);
        }
    }

    _getSettingWithFallback(newKey, oldKey, defaultValue) {
        const v = this._settings.get_string(newKey);
        if (v && v.length) return v;
        try {
            return this._settings.get_string(oldKey);
        } catch (e) {
            return defaultValue;
        }
    }

    disable() {
        if (this._monitorRebuildSourceId) {
            GLib.source_remove(this._monitorRebuildSourceId);
            this._monitorRebuildSourceId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._appGridShowNamesChangedId) {
            this._settings.disconnect(this._appGridShowNamesChangedId);
            this._appGridShowNamesChangedId = 0;
        }

        // Повертаємо підписи назв програм у стандартний (видимий) стан
        // і від'єднуємо обробники наведення, додані для режиму "hover"
        if (this._appDisplay && this._appDisplay._grid) {
            const gridActor = this._appDisplay._grid;
            for (let i = 0; i < gridActor.get_n_children(); i++) {
                const item = gridActor.get_child_at_index(i);
                const label = item?.icon?.label;
                if (label) label.visible = true;
                if (item?.icon?.icon) {
                    IconAnimator.reset(item.icon.icon);
                    const icon = item.icon.icon;
                    if (icon._chOriginalIconSize !== undefined) {
                        icon.icon_size = icon._chOriginalIconSize;
                        icon.set_size(-1, -1);
                        icon._chOriginalIconSize = undefined;
                    }
                }
                if (item?._chHoverHandlerId) {
                    item.disconnect(item._chHoverHandlerId);
                    item._chHoverHandlerId = 0;
                }
                if (item?._chPressHandlerId) {
                    item.disconnect(item._chPressHandlerId);
                    item._chPressHandlerId = 0;
                }
            }
        }

        this._unpatchControlsLayout();
        this._unpatchAppGrid();

        if (this._appCapturedId && this._appDisplay) {
            this._appDisplay.disconnect(this._appCapturedId);
            this._appCapturedId = 0;
        }
        if (this._wsCapturedId && this._workspacesDisplay) {
            this._workspacesDisplay.disconnect(this._wsCapturedId);
            this._wsCapturedId = 0;
        }

        // Відновлення workspaces view
        this._unpatchVerticalWorkspaces();

        // Відновлення напрямку посторінкової навігації AppGrid
        if (
            this._appDisplay &&
            this._appDisplay._grid &&
            this._appDisplay._grid._verticalPatched
        ) {
            delete this._appDisplay._grid._verticalPatched;
            this._appDisplay._grid.layout_manager.orientation =
                this._origAppGridOrientation;
            this._appDisplay._orientation = this._origAppDisplayOrientation;
            if (this._appDisplay._swipeTracker)
                this._appDisplay._swipeTracker.orientation =
                    this._origSwipeOrientation;
            this._appDisplay._adjustment = this._origAppGridAdjustment;
            this._appDisplay._scrollView.hscrollbar_policy =
                this._origHScrollbarPolicy;
            this._appDisplay._scrollView.vscrollbar_policy =
                this._origVScrollbarPolicy;
            this._appDisplay._grid.queue_relayout();
        }

        this._layoutManager?.layout_changed();
        this._layoutManager = null;
        this._workspacesDisplay = null;
        this._appDisplay = null;
        this._controls = null;

        if (this._searchEntry) {
            this._searchEntry.visible = true;
            this._searchEntry.set_height(-1);
        }
        this._searchEntry = null;

        this._container?.destroy();
        this._container = null;
        this._backgrounds = [];
        this._settings = null;
    }
}
