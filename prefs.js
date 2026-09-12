import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import {
    ExtensionPreferences,
    gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Індекси відповідають порядку рядків у Gtk.StringList нижче.
const SCROLL_DIRECTIONS = ["vertical", "horizontal"];

// Індекси відповідають порядку рядків у Gtk.StringList нижче.
const APP_GRID_NAMES_VISIBILITY = ["always", "never", "hover"];

// Індекси відповідають порядку рядків у Gtk.StringList для рядка
// "Розмір" у групі "Розмір іконок" — значення в px застосовуються
// в extension.js (див. ICON_SIZE_PX там же).
const APP_GRID_ICON_SIZE = ["small", "medium", "large", "extra-large"];

const APP_GRID_ORDER = [
    "manual",
    "name-ascending",
    "name-descending",
    "usage",
    "last-used",
];

// Індекси відповідають порядку рядків у Gtk.StringList для випадаючих
// меню кривих анімації іконок (група "Анімація іконок").
const ICON_ANIMATION_CURVES = [
    "Back",
    "Bounce",
    "Circ",
    "Cubic",
    "Elastic",
    "Expo",
    "Linear",
    "Quad",
    "Quart",
    "Quint",
    "Sine",
];

export default class OverviewBackgroundPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        this._buildGeneralPage(window, settings);
        this._buildWorkspacesPage(window, settings);
        this._buildAppGridPage(window, settings);
    }

    // --- Вкладка "Загальне" ---
    _buildGeneralPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _("Загальне"),
            icon_name: "preferences-desktop-wallpaper-symbolic",
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _("Тло"),
        });
        page.add(group);

        // --- Рядок 1: Увімкнути тло (перемикач) ---
        const enableRow = new Adw.ActionRow({
            title: _("Увімкнути тло"),
        });
        const enableSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "enabled",
            enableSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        enableRow.add_suffix(enableSwitch);
        enableRow.activatable_widget = enableSwitch;
        group.add(enableRow);

        // --- Рядок 2: Яскравість (регулятор) ---
        const brightnessRow = new Adw.ActionRow({
            title: _("Яскравість"),
        });
        const brightnessAdjustment = new Gtk.Adjustment({
            lower: -100,
            upper: 100,
            step_increment: 5,
            page_increment: 5,
            value: settings.get_int("brightness"),
        });
        const brightnessScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: brightnessAdjustment,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 180,
            digits: 0,
            draw_value: true,
        });
        settings.bind(
            "brightness",
            brightnessAdjustment,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        brightnessRow.add_suffix(brightnessScale);
        group.add(brightnessRow);

        // --- Рядок 3: Розмиття (регулятор) ---
        const blurRow = new Adw.ActionRow({
            title: _("Розмиття"),
        });
        const blurAdjustment = new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int("blur"),
        });
        const blurScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: blurAdjustment,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 180,
            digits: 0,
            draw_value: true,
        });
        settings.bind(
            "blur",
            blurAdjustment,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        blurRow.add_suffix(blurScale);
        group.add(blurRow);

        // --- Рядок 4: Насиченість (регулятор) ---
        const saturationRow = new Adw.ActionRow({
            title: _("Насиченість"),
        });
        const saturationAdjustment = new Gtk.Adjustment({
            lower: 0.0,
            upper: 2.0,
            step_increment: 0.1,
            page_increment: 0.1,
            value: settings.get_double("saturation"),
        });
        const saturationScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: saturationAdjustment,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 180,
            digits: 1,
            draw_value: true,
        });
        settings.bind(
            "saturation",
            saturationAdjustment,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        saturationRow.add_suffix(saturationScale);
        group.add(saturationRow);

        // --- Рядок 5: Зернистість (регулятор) ---
        const grainRow = new Adw.ActionRow({
            title: _("Зернистість"),
        });
        const grainAdjustment = new Gtk.Adjustment({
            lower: 0,
            upper: 100,
            step_increment: 5,
            page_increment: 5,
            value: settings.get_int("grain"),
        });
        const grainScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: grainAdjustment,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 180,
            digits: 0,
            draw_value: true,
        });
        settings.bind(
            "grain",
            grainAdjustment,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        grainRow.add_suffix(grainScale);
        group.add(grainRow);

        // --- Група "Поле пошуку" ---
        const searchGroup = new Adw.PreferencesGroup({
            title: _("Поле пошуку"),
        });
        page.add(searchGroup);

        const searchRow = new Adw.ActionRow({
            title: _("Показувати поле пошуку"),
        });
        const searchSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-search-entry",
            searchSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        searchRow.add_suffix(searchSwitch);
        searchRow.activatable_widget = searchSwitch;
        searchGroup.add(searchRow);

        // --- Група "Робочі столи" ---
        const workspacesGroup = new Adw.PreferencesGroup({
            title: _("Мініатюри робочих столів"),
        });
        page.add(workspacesGroup);

        const workspacesRow = new Adw.ActionRow({
            title: _("Показувати мініатюри робочих столів"),
        });
        const workspacesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-workspaces-thumbnails",
            workspacesSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        workspacesRow.add_suffix(workspacesSwitch);
        workspacesRow.activatable_widget = workspacesSwitch;
        workspacesGroup.add(workspacesRow);
    }

    // --- Вкладка "Стільниці" ---
    _buildWorkspacesPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _("Стільниці"),
            icon_name: "view-grid-symbolic",
        });
        window.add(page);

        const sizeGroup = new Adw.PreferencesGroup({
            title: _("Розмір стільниці"),
        });
        page.add(sizeGroup);

        const sizeRow = new Adw.ActionRow({
            title: _("Розмір стільниці"),
        });
        const sizeAdjustment = new Gtk.Adjustment({
            lower: -100,
            upper: 100,
            step_increment: 1,
            page_increment: 5,
            value: settings.get_int("workspace-size"),
        });
        const sizeScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: sizeAdjustment,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 180,
            digits: 0,
            draw_value: true,
        });
        settings.bind(
            "workspace-size",
            sizeAdjustment,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        sizeRow.add_suffix(sizeScale);
        sizeGroup.add(sizeRow);

        this._addScrollDirectionGroup(
            page,
            settings,
            "workspaces-scroll-direction",
        );

        const closeButtonGroup = new Adw.PreferencesGroup({
            title: _("Кнопка закриття"),
        });
        page.add(closeButtonGroup);

        const closeButtonRow = new Adw.ActionRow({
            title: _("Показувати кнопку закриття вікна"),
        });
        const closeButtonSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-window-close-button",
            closeButtonSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        closeButtonRow.add_suffix(closeButtonSwitch);
        closeButtonRow.activatable_widget = closeButtonSwitch;
        closeButtonGroup.add(closeButtonRow);

        const tooltipGroup = new Adw.PreferencesGroup({
            title: _("Підказка"),
        });
        page.add(tooltipGroup);

        const tooltipRow = new Adw.ComboRow({
            title: _("Розташування"),
            model: new Gtk.StringList({
                strings: [_("Над іконкою"), _("Під іконкою")],
            }),
        });

        const tooltipPositions = ["above", "below"];
        const currentTooltipPosition = settings.get_string(
            "workspace-tooltip-position",
        );
        const currentTooltipIndex = tooltipPositions.indexOf(
            currentTooltipPosition,
        );
        tooltipRow.set_selected(
            currentTooltipIndex >= 0 ? currentTooltipIndex : 0,
        );

        tooltipRow.connect("notify::selected", () => {
            const value = tooltipPositions[tooltipRow.selected] ?? "above";
            if (settings.get_string("workspace-tooltip-position") !== value)
                settings.set_string("workspace-tooltip-position", value);
        });

        tooltipGroup.add(tooltipRow);
    }

    // --- Вкладка "Сітка програм" ---
    _buildAppGridPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _("Сітка програм"),
            icon_name: "view-app-grid-symbolic",
        });
        window.add(page);

        // Створюємо групу "Сітка"
        const gridGroup = new Adw.PreferencesGroup({
            title: _("Сітка"),
        });
        page.add(gridGroup);

        // --- Рядок: Кількість стовбців ---
        const colsRow = new Adw.ActionRow({
            title: _("Кількість стовбців"),
        });
        const colsSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 15,
                step_increment: 1,
            }),
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "app-grid-columns",
            colsSpin,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        colsRow.add_suffix(colsSpin);
        gridGroup.add(colsRow);

        // --- Рядок: Кількість рядків ---
        const rowsRow = new Adw.ActionRow({
            title: _("Кількість рядків"),
        });
        const rowsSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 3,
                upper: 9,
                step_increment: 1,
            }),
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "app-grid-rows",
            rowsSpin,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        rowsRow.add_suffix(rowsSpin);
        gridGroup.add(rowsRow);

        const iconSizeGroup = new Adw.PreferencesGroup({
            title: _("Розмір іконок"),
        });
        page.add(iconSizeGroup);

        const iconSizeRow = new Adw.ComboRow({
            title: _("Розмір"),
            model: new Gtk.StringList({
                strings: [
                    _("Маленький 48 px"),
                    _("Середній 64 px"),
                    _("Великий 80 px"),
                    _("Дуже великий 96 px"),
                ],
            }),
        });

        const currentIconSizeValue = settings.get_string("app-grid-icon-size");
        const currentIconSizeIndex =
            APP_GRID_ICON_SIZE.indexOf(currentIconSizeValue);
        iconSizeRow.set_selected(
            currentIconSizeIndex >= 0 ? currentIconSizeIndex : 1,
        );

        iconSizeRow.connect("notify::selected", () => {
            const value = APP_GRID_ICON_SIZE[iconSizeRow.selected] ?? "medium";
            if (settings.get_string("app-grid-icon-size") !== value)
                settings.set_string("app-grid-icon-size", value);
        });

        // Синхронізуємо рядок, якщо значення зміниться ззовні.
        const iconSizeChangedId = settings.connect(
            "changed::app-grid-icon-size",
            () => {
                const value = settings.get_string("app-grid-icon-size");
                const index = APP_GRID_ICON_SIZE.indexOf(value);
                if (index >= 0 && index !== iconSizeRow.selected)
                    iconSizeRow.set_selected(index);
            },
        );
        iconSizeRow.connect("destroy", () =>
            settings.disconnect(iconSizeChangedId),
        );

        iconSizeGroup.add(iconSizeRow);

        this._addIconAnimationGroups(page, settings);

        // --- Група "Назви програм" ---
        const namesGroup = new Adw.PreferencesGroup({
            title: _("Назви програм"),
        });
        page.add(namesGroup);

        const namesRow = new Adw.ComboRow({
            title: _("Відображення назв"),
            model: new Gtk.StringList({
                strings: [
                    _("Завжди показувати"),
                    _("Ніколи не показувати"),
                    _("Показувати при наведенні"),
                ],
            }),
        });

        const currentNamesValue = settings.get_string(
            "app-grid-names-visibility",
        );
        const currentNamesIndex =
            APP_GRID_NAMES_VISIBILITY.indexOf(currentNamesValue);
        namesRow.set_selected(currentNamesIndex >= 0 ? currentNamesIndex : 0);

        namesRow.connect("notify::selected", () => {
            const value =
                APP_GRID_NAMES_VISIBILITY[namesRow.selected] ?? "always";
            if (settings.get_string("app-grid-names-visibility") !== value)
                settings.set_string("app-grid-names-visibility", value);
        });

        // Синхронізуємо рядок, якщо значення зміниться ззовні
        // (наприклад, через dconf-editor чи gsettings у терміналі).
        const namesChangedId = settings.connect(
            "changed::app-grid-names-visibility",
            () => {
                const value = settings.get_string("app-grid-names-visibility");
                const index = APP_GRID_NAMES_VISIBILITY.indexOf(value);
                if (index >= 0 && index !== namesRow.selected)
                    namesRow.set_selected(index);
            },
        );
        namesRow.connect("destroy", () => settings.disconnect(namesChangedId));

        namesGroup.add(namesRow);

        // Існуюча група орієнтації
        this._addScrollDirectionGroup(
            page,
            settings,
            "app-grid-scroll-direction",
        );

        const navigationGroup = new Adw.PreferencesGroup({
            title: _("Показувати кнопки навігації"),
        });
        page.add(navigationGroup);

        const navigationRow = new Adw.ActionRow({
            title: _("Показувати кнопки навігації"),
        });
        const navigationSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-app-grid-navigation-buttons",
            navigationSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        navigationRow.add_suffix(navigationSwitch);
        navigationRow.activatable_widget = navigationSwitch;
        navigationGroup.add(navigationRow);

        const orderGroup = new Adw.PreferencesGroup({
            title: _("Упорядкування"),
        });
        page.add(orderGroup);

        const orderRow = new Adw.ComboRow({
            title: _("Упорядкувати:"),
            model: new Gtk.StringList({
                strings: [
                    _("Ручний"),
                    _("A → Z / А → Я"),
                    _("Z → A / Я → А"),
                    _("За частотою використання"),
                    _("За останнім запуском"),
                ],
            }),
        });
        const currentOrder = APP_GRID_ORDER.indexOf(
            settings.get_string("app-grid-order"),
        );
        orderRow.set_selected(currentOrder >= 0 ? currentOrder : 0);
        orderRow.connect("notify::selected", () => {
            const value = APP_GRID_ORDER[orderRow.selected] ?? "manual";
            if (settings.get_string("app-grid-order") !== value)
                settings.set_string("app-grid-order", value);
        });
        const orderChangedId = settings.connect(
            "changed::app-grid-order",
            () => {
                const value = settings.get_string("app-grid-order");
                const index = APP_GRID_ORDER.indexOf(value);
                if (index >= 0 && index !== orderRow.selected)
                    orderRow.set_selected(index);
            },
        );
        orderRow.connect("destroy", () => settings.disconnect(orderChangedId));
        orderGroup.add(orderRow);

        const pinnedAppsGroup = new Adw.PreferencesGroup({
            title: _("Показувати пришпилені програми"),
        });
        page.add(pinnedAppsGroup);

        const pinnedAppsRow = new Adw.ActionRow({
            title: _("Показувати пришпилені програми"),
        });
        const pinnedAppsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind(
            "show-pinned-apps",
            pinnedAppsSwitch,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        pinnedAppsRow.add_suffix(pinnedAppsSwitch);
        pinnedAppsRow.activatable_widget = pinnedAppsSwitch;
        pinnedAppsGroup.add(pinnedAppsRow);
    }

    // Спільний будівник групи "Орієнтація" з рядком вибору напрямку
    // прокручування — використовується і для стільниць, і для сітки
    // програм, аби не дублювати однакову розмітку двічі.
    _addScrollDirectionGroup(page, settings, settingsKey) {
        const group = new Adw.PreferencesGroup({
            title: _("Орієнтація"),
        });
        page.add(group);

        const row = new Adw.ComboRow({
            title: _("Напрямок прокручування"),
            model: new Gtk.StringList({
                strings: [_("Вертикальний"), _("Горизонтальний")],
            }),
        });

        const currentValue = settings.get_string(settingsKey);
        const currentIndex = SCROLL_DIRECTIONS.indexOf(currentValue);
        row.set_selected(currentIndex >= 0 ? currentIndex : 0);

        row.connect("notify::selected", () => {
            const direction = SCROLL_DIRECTIONS[row.selected] ?? "vertical";
            if (settings.get_string(settingsKey) !== direction)
                settings.set_string(settingsKey, direction);
        });

        // Синхронізуємо рядок, якщо значення зміниться ззовні
        // (наприклад, через dconf-editor чи gsettings у терміналі).
        const changedId = settings.connect(`changed::${settingsKey}`, () => {
            const value = settings.get_string(settingsKey);
            const index = SCROLL_DIRECTIONS.indexOf(value);
            if (index >= 0 && index !== row.selected) row.set_selected(index);
        });
        row.connect("destroy", () => settings.disconnect(changedId));

        group.add(row);
    }

    // Групи "Анімація іконок" та "Масштабування іконок" для вкладки
    // "Сітка програм" — налаштування bounce-масштабування іконок при
    // наведенні та натисканні. Сама анімація виконується в
    // extension.js/iconAnimations.js — тут лише інтерфейс налаштувань.
    _addIconAnimationGroups(page, settings) {
        const animGroup = new Adw.PreferencesGroup({
            title: _("Анімація іконок"),
        });
        page.add(animGroup);

        animGroup.add(
            this._buildIconAnimationExpander(settings, {
                title: _("Анімація при наведенні"),
                curveKey: "app-grid-icon-hover-curve",
                inDurationsKey: "app-grid-icon-hover-in-durations",
                outDurationsKey: "app-grid-icon-hover-out-durations",
                inTitle: _("Швидкість при наведенні"),
                outTitle: _("Швидкість при відведенні"),
            }),
        );

        animGroup.add(
            this._buildIconAnimationExpander(settings, {
                title: _("Анімація при натисканні"),
                curveKey: "app-grid-icon-press-curve",
                inDurationsKey: "app-grid-icon-press-in-durations",
                outDurationsKey: "app-grid-icon-press-out-durations",
                inTitle: _("Швидкість при натисканні"),
                outTitle: _("Швидкість при відпусканні"),
            }),
        );

        const scaleGroup = new Adw.PreferencesGroup({
            title: _("Масштабування іконок"),
        });
        page.add(scaleGroup);

        scaleGroup.add(
            this._buildIconScaleRow(settings, {
                title: _("Масштаб при наведенні"),
                settingsKey: "app-grid-icon-hover-scale",
            }),
        );
        scaleGroup.add(
            this._buildIconScaleRow(settings, {
                title: _("Масштаб при натисканні"),
                settingsKey: "app-grid-icon-press-scale",
            }),
        );
    }

    // Читає збережену тривалість для конкретної кривої з dict-налаштування
    // (тип "a{si}": ключ — назва кривої, значення — мс). Якщо для цієї
    // кривої ще нічого не збережено — фолбек 200 мс (той самий default,
    // що й у схемі).
    _getCurveDuration(settings, key, curveName) {
        const dict = settings.get_value(key).deep_unpack();
        return curveName in dict ? dict[curveName] : 200;
    }

    // Записує тривалість лише для однієї кривої, не чіпаючи збережені
    // значення інших кривих у тому ж dict-налаштуванні.
    _setCurveDuration(settings, key, curveName, value) {
        const dict = settings.get_value(key).deep_unpack();
        dict[curveName] = value;
        settings.set_value(key, new GLib.Variant("a{si}", dict));
    }

    // Один ExpanderRow з випадаючим меню кривої в кінці заголовка та
    // двома вкладеними ActionRow-регуляторами тривалості (розкриваються
    // при натисканні на рядок). Кожна крива пам'ятає власні значення
    // тривалості — перемикання кривої в меню підвантажує її власні
    // збережені швидкості, а не ділить одне спільне значення на всі.
    _buildIconAnimationExpander(
        settings,
        { title, curveKey, inDurationsKey, outDurationsKey, inTitle, outTitle },
    ) {
        const expander = new Adw.ExpanderRow({ title });

        const curveDropdown = new Gtk.DropDown({
            model: new Gtk.StringList({ strings: ICON_ANIMATION_CURVES }),
            valign: Gtk.Align.CENTER,
        });

        const currentCurve = settings.get_string(curveKey);
        const currentCurveIndex = ICON_ANIMATION_CURVES.indexOf(currentCurve);
        curveDropdown.set_selected(
            currentCurveIndex >= 0 ? currentCurveIndex : 0,
        );

        const getCurveName = () =>
            ICON_ANIMATION_CURVES[curveDropdown.selected] ?? "Quad";

        const inRow = this._buildCurveDurationRow(
            settings,
            inDurationsKey,
            inTitle,
            getCurveName,
        );
        const outRow = this._buildCurveDurationRow(
            settings,
            outDurationsKey,
            outTitle,
            getCurveName,
        );

        curveDropdown.connect("notify::selected", () => {
            const value = getCurveName();
            if (settings.get_string(curveKey) !== value)
                settings.set_string(curveKey, value);
            // Показуємо тривалості, збережені саме для нової кривої.
            inRow.refresh();
            outRow.refresh();
        });

        // Синхронізуємо меню, якщо значення зміниться ззовні.
        const curveChangedId = settings.connect(`changed::${curveKey}`, () => {
            const value = settings.get_string(curveKey);
            const index = ICON_ANIMATION_CURVES.indexOf(value);
            if (index >= 0 && index !== curveDropdown.selected)
                curveDropdown.set_selected(index);
        });
        expander.connect("destroy", () => settings.disconnect(curveChangedId));

        expander.add_suffix(curveDropdown);
        expander.add_row(inRow.row);
        expander.add_row(outRow.row);

        return expander;
    }

    // Один ActionRow-регулятор тривалості (0–1000 мс, крок 50), значення
    // якого прив'язане до тривалості поточної (getCurveName()) кривої в
    // dict-налаштуванні durationsKey. Повертає { row, refresh } — refresh
    // перечитує значення для щойно обраної кривої без запису в dict.
    _buildCurveDurationRow(settings, durationsKey, title, getCurveName) {
        const row = new Adw.ActionRow({ title });
        const adjustment = new Gtk.Adjustment({
            lower: 0,
            upper: 1000,
            step_increment: 50,
            page_increment: 100,
            value: this._getCurveDuration(
                settings,
                durationsKey,
                getCurveName(),
            ),
        });
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 180,
            digits: 0,
            draw_value: true,
        });
        row.add_suffix(scale);

        // Захист від зворотного запису під час програмного оновлення
        // adjustment.value (при refresh() чи синхронізації ззовні) —
        // інакше "перечитування" саме по собі викликало б запис.
        let suppress = false;

        adjustment.connect("value-changed", () => {
            if (suppress) return;
            this._setCurveDuration(
                settings,
                durationsKey,
                getCurveName(),
                Math.round(adjustment.value),
            );
        });

        const changedId = settings.connect(`changed::${durationsKey}`, () => {
            const value = this._getCurveDuration(
                settings,
                durationsKey,
                getCurveName(),
            );
            if (value !== adjustment.value) {
                suppress = true;
                adjustment.set_value(value);
                suppress = false;
            }
        });
        row.connect("destroy", () => settings.disconnect(changedId));

        return {
            row,
            refresh: () => {
                suppress = true;
                adjustment.set_value(
                    this._getCurveDuration(
                        settings,
                        durationsKey,
                        getCurveName(),
                    ),
                );
                suppress = false;
            },
        };
    }

    // Один ActionRow-регулятор масштабу іконки (0.50–1.50, крок 0.01).
    _buildIconScaleRow(settings, { title, settingsKey }) {
        const row = new Adw.ActionRow({ title });
        const adjustment = new Gtk.Adjustment({
            lower: 0.5,
            upper: 1.5,
            step_increment: 0.01,
            page_increment: 0.1,
            value: settings.get_double(settingsKey),
        });
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            width_request: 180,
            digits: 2,
            draw_value: true,
        });
        settings.bind(
            settingsKey,
            adjustment,
            "value",
            Gio.SettingsBindFlags.DEFAULT,
        );
        row.add_suffix(scale);
        return row;
    }
}
