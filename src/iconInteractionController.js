import GLib from "gi://GLib";
import Pango from "gi://Pango";
import Clutter from "gi://Clutter";
import { IconAnimator } from "./iconAnimations.js";

export class IconInteractionController {
    static ICON_TEXTURE_OVERSAMPLE = 1.5;

    static ICON_SIZE = {
        smallest: 60,
        small: 70,
        normal: 80,
        large: 90,
        largest: 100,
    };

    static LABEL_OFFSET_Y = 40;

    static APP_ICON_TILE_SIZE = 150;

    static HOVER_Z_POSITION = 0.00000001;

    /*
     * Базовий розмір AppIcon-tile (те, що бачить grid: measureAppIconSize /
     * _getChildrenMaxSize / slot-fit геометрія) НЕ дорівнює "сирому"
     * baseIconSize, який GNOME рахує лише для самої іконки (~111px).
     * Раніше AppIcon фактично мав ~137px (бо його розмір випадково
     * "плив" за обраним режимом іконки). Тепер, коли tile зафіксований
     * незалежно від режиму, цей коефіцієнт визначає його еталонний
     * розмір відносно baseIconSize — підберіть під потрібний px-розмір
     * tile (137 / 111 ≈ 1.234 і дає стартове значення нижче).
     */
    static TILE_REFERENCE_SCALE = 1.5;

    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
    }

    /*
     * Єдина точка визначення "еталонного" (не залежного від режиму
     * розміру іконки) розміру для даного item. lockTileSize() та
     * applyIconSize() МУСЯТЬ використовувати саме це значення, інакше
     * при scale=1.0 ("Звичайний") іконка перестане точно відповідати
     * зафіксованому розміру tile.
     */
    _resolveNominalSize(icon, baseSize) {
        const raw =
            Number.isFinite(baseSize) && baseSize > 0
                ? baseSize
                : icon._chOriginalIconSize;

        return Math.max(
            1,
            Math.round(raw * IconInteractionController.TILE_REFERENCE_SCALE),
        );
    }

    updateNamesVisibility() {
        const grid = this._appDisplay?._grid;
        if (!grid) return;
        const mode = this._settings.get_string("app-grid-names-visibility");
        for (let index = 0; index < grid.get_n_children(); index++)
            this.applyNameVisibilityMode(grid.get_child_at_index(index), mode);
    }

    applyNameVisibilityMode(item, mode) {
        const label = item?.icon?.label;

        if (!label) return;

        this._ensureHoverHandler(item);

        const shouldShow =
            mode === "always" ||
            (mode === "hover" && item._chIconHovered === true);

        label.visible = shouldShow;
    }

    lockTileSize(item, _baseSize = null) {
        if (!item || item.is_destroyed?.()) return null;

        /*
         * Блокуємо саме геометрію AppIcon.
         *
         * Графічну іконку тут НЕ чіпаємо.
         * Її розміром займається applyIconSize().
         */
        this._installFixedPreferredSize(item);

        return IconInteractionController.APP_ICON_TILE_SIZE;
    }

    /*
     * Застосовує обраний режим розміру ЛИШЕ до графічної іконки
     * всередині AppIcon. Розмір самого AppIcon (tile) при цьому
     * НЕ перераховується — він має бути вже зафіксований
     * попереднім викликом lockTileSize() для цього ж item.
     */
    applyIconSize(item, _baseSize = null) {
        console.log(
            `CH-APPLY-SIZE label="${item?.icon?.label?.text ?? "<no label>"}" ` +
                `scale=${item?.icon?.icon?.scale_x}`,
        );

        const icon = item?.icon?.icon;
        if (!icon || icon.is_destroyed?.()) return;

        const key = this._settings.get_string("app-grid-icon-size");

        const size =
            IconInteractionController.ICON_SIZE[key] ??
            IconInteractionController.ICON_SIZE.normal;

        this._installFixedIconPreferredSize(icon, size);

        /*
         * Базовий scale завжди 1.0.
         *
         * app-grid-icon-size задає реальний розмір allocation,
         * а не коефіцієнт масштабу.
         */
        icon._chIconSizeScale = 1.0;

        /*
         * Texture oversampling.
         *
         * icon_size відповідає за якість текстури,
         * але не за геометричний розмір St.Icon.
         */
        icon.icon_size = Math.round(
            size * IconInteractionController.ICON_TEXTURE_OVERSAMPLE,
        );

        icon.set_size(size, size);

        icon.set_pivot_point(0.5, 0.5);

        const baseIcon = item?.icon;
        const iconBin = baseIcon?._iconBin;

        icon.clip_to_allocation = false;

        if (iconBin) {
            iconBin.clip_to_allocation = false;
            iconBin.y_align = Clutter.ActorAlign.CENTER;
        }

        if (baseIcon) baseIcon.clip_to_allocation = false;

        if (item?._iconContainer)
            item._iconContainer.clip_to_allocation = false;

        if (item) item.clip_to_allocation = false;

        if (!item.has_style_class_name?.("app-folder"))
            this._ensureLabelOverlay(item);

        /*
         * TEMPORARY GEOMETRY DEBUG
         *
         * Перевіряємо реальні позиції AppIcon → BaseIcon → _iconBin → St.Icon.
         * Важливо: виконуємо після allocation, щоб не ловити "needs allocation".
         */
        if (!item._chGeometryDebugScheduled) {
            const debugItem = item;
            const debugBaseIcon = baseIcon;
            const debugIconBin = iconBin;
            const debugIcon = icon;

            debugItem._chGeometryDebugScheduled = true;

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                debugItem._chGeometryDebugScheduled = false;

                if (debugItem.is_destroyed?.() || debugIcon.is_destroyed?.())
                    return GLib.SOURCE_REMOVE;

                const getInfo = (actor) => {
                    if (!actor || actor.is_destroyed?.()) return "null";

                    let pos = [NaN, NaN];

                    try {
                        pos = actor.get_transformed_position();
                    } catch {}

                    return (
                        `pos=(${Number(pos?.[0]).toFixed(1)},${Number(pos?.[1]).toFixed(1)}) ` +
                        `xy=(${Number(actor.x).toFixed(1)},${Number(actor.y).toFixed(1)}) ` +
                        `size=(${Number(actor.width).toFixed(1)}x${Number(actor.height).toFixed(1)}) ` +
                        `translation=(${Number(actor.translation_x).toFixed(1)},${Number(actor.translation_y).toFixed(1)}) ` +
                        `scale=(${Number(actor.scale_x).toFixed(3)},${Number(actor.scale_y).toFixed(3)})`
                    );
                };

                console.log(
                    `CH-GEOMETRY ` +
                        `label="${debugItem?.icon?.label?.text ?? "<no label>"}" ` +
                        `\n  ITEM     ${getInfo(debugItem)}` +
                        `\n  BASEICON ${getInfo(debugBaseIcon)}` +
                        `\n  ICONBIN  ${getInfo(debugIconBin)}` +
                        `\n  ICON     ${getInfo(debugIcon)}`,
                );

                return GLib.SOURCE_REMOVE;
            });
        }
    }

    disable() {
        const grid = this._appDisplay?._grid;
        if (!grid) return;
        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);
            const label = item?.icon?.label;
            if (
                label &&
                item?.icon?._box &&
                label.get_parent() === item?._iconContainer
            ) {
                item._iconContainer.remove_child(label);
                item.icon._box.add_child(label);

                label.set_width(-1);
                label.translation_y = 0;

                label.x_align = Clutter.ActorAlign.FILL;
                label.y_align = Clutter.ActorAlign.FILL;

                label.x_expand = false;
                label.y_expand = false;

                label.clip_to_allocation = true;

                item.icon._box.queue_relayout();
            }
            if (label && label._chLabelLayoutTestInstalled) {
                label.get_preferred_size =
                    label._chLabelLayoutTestOriginalGetPreferredSize;

                label._chLabelLayoutTestOriginalGetPreferredSize = null;
                label._chLabelLayoutTestInstalled = false;

                label.queue_relayout();
                label.get_parent()?.queue_relayout();
            }
            if (label) label.visible = true;
            const icon = item?.icon?.icon;
            if (icon) {
                IconAnimator.reset(icon);
                if (icon._chFixedPreferredSizeInstalled) {
                    icon.get_preferred_size = icon._chOriginalGetPreferredSize;
                    icon._chOriginalGetPreferredSize = null;
                    icon._chFixedPreferredSize = null;
                    icon._chFixedPreferredSizeInstalled = false;
                }

                icon.set_scale(1.0, 1.0);
                icon.set_size(-1, -1);
            }

            /*
             * Прибираємо наш secondary-click gesture
             * з графічної іконки.
             */
            if (
                item._chRightClickGesture &&
                item._chRightClickGestureActor &&
                !item._chRightClickGestureActor.is_destroyed?.()
            ) {
                item._chRightClickGestureActor.remove_action(
                    item._chRightClickGesture,
                );
            }

            item._chRightClickGesture = null;
            item._chRightClickGestureActor = null;

            if (
                item._chLeftClickGesture &&
                item._chLeftClickGestureActor &&
                !item._chLeftClickGestureActor.is_destroyed?.()
            ) {
                item._chLeftClickGestureActor.remove_action(
                    item._chLeftClickGesture,
                );
            }

            item._chLeftClickGesture = null;
            item._chLeftClickGestureActor = null;
            /*
             * Повертаємо штатний DND gesture назад на AppIcon.
             */
            if (item._chDndGesture) {
                const gesture = item._chDndGesture;
                const gestureActor = item._chDndGestureActor;

                if (gestureActor && !gestureActor.is_destroyed?.())
                    gestureActor.remove_action(gesture);

                item.add_action(gesture);

                item._chDndGesture = null;
                item._chDndGestureActor = null;
            }

            /*
             * Від'єднуємо наш lock reactive=false.
             */
            if (item._chDndReactiveLockId) {
                item._draggable?.disconnect(item._chDndReactiveLockId);
                item._chDndReactiveLockId = 0;
            }

            /*
             * Повертаємо штатну інтерактивність AppIcon.
             */
            item.reactive = true;
            item.track_hover = true;

            if (icon) icon.reactive = false;
            const hoverIcon = item._chHoverIcon ?? icon;

            if (hoverIcon && !hoverIcon.is_destroyed?.()) {
                if (item._chIconEnterId) {
                    hoverIcon.disconnect(item._chIconEnterId);
                    item._chIconEnterId = 0;
                }

                if (item._chIconLeaveId) {
                    hoverIcon.disconnect(item._chIconLeaveId);
                    item._chIconLeaveId = 0;
                }
            }

            item._chHoverIcon = null;
            item._chHoverInteractionInstalled = false;
            item._chIconHovered = false;

            if (item?._chHoverHandlerId) {
                item.disconnect(item._chHoverHandlerId);
                item._chHoverHandlerId = 0;
            }
            if (item?._chPressHandlerId) {
                item.disconnect(item._chPressHandlerId);
                item._chPressHandlerId = 0;
            }
            if (item?._chOriginalUpdateMultiline) {
                item._updateMultiline = item._chOriginalUpdateMultiline;

                item._chOriginalUpdateMultiline = null;
            }

            if (item?._chFixedPreferredSizeInstalled) {
                item.get_preferred_size = item._chOriginalGetPreferredSize;

                item._chOriginalGetPreferredSize = null;
                item._chFixedPreferredSize = null;
                item._chFixedPreferredSizeInstalled = false;
            }

            item.clip_to_allocation = true;

            if (item.icon) item.icon.clip_to_allocation = true;

            if (item.icon?._iconBin)
                item.icon._iconBin.clip_to_allocation = true;

            if (icon) icon.clip_to_allocation = true;

            if (item._iconContainer)
                item._iconContainer.clip_to_allocation = true;

            item.z_position = 0;
        }
    }

    _animate(item, kind, activeOverride = null) {
        const icon = item?.icon?.icon;
        if (!icon) return;

        const active =
            activeOverride !== null
                ? activeOverride
                : kind === "press"
                  ? item.pressed
                  : item.hover;

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

    _getCurveDuration(key, curveName) {
        const values = this._settings.get_value(key).deep_unpack();
        return curveName in values ? values[curveName] : 200;
    }

    _enableLabelLayoutTest(item) {
        const label = item?.icon?.label;

        if (!label) return;

        if (label._chLabelLayoutTestInstalled) return;

        const original = label.get_preferred_size;

        if (typeof original !== "function") return;

        label._chLabelLayoutTestOriginalGetPreferredSize = original;

        label._chLabelLayoutTestInstalled = true;

        label.queue_relayout();
        label.get_parent()?.queue_relayout();
        item.queue_relayout();
    }

    _ensureLabelOverlay(item) {
        const baseIcon = item?.icon;
        const label = baseIcon?.label;
        const container = item?._iconContainer;
        const icon = baseIcon?.icon;

        if (!label || !container || !icon) return;

        /*
         * Якщо label ще знаходиться всередині BaseIcon._box —
         * виносимо його в overlay AppIcon.
         */
        if (label.get_parent() !== container) {
            const parent = label.get_parent();

            if (parent) parent.remove_child(label);

            container.add_child(label);
        }

        /*
         * Label більше не бере участі в геометрії BaseIcon.
         */
        label.x_expand = false;
        label.y_expand = false;

        label.x_align = Clutter.ActorAlign.CENTER;
        label.y_align = Clutter.ActorAlign.START;

        const labelWidth = IconInteractionController.APP_ICON_TILE_SIZE;

        label.set_width(labelWidth);

        label.clip_to_allocation = false;

        /*
         * Запам'ятовуємо висоту одного рядка до того,
         * як label почне розгортатися при hover.
         */
        if (!label._chSingleLineHeight) {
            const [, naturalHeight] = label.get_preferred_height(labelWidth);

            if (Number.isFinite(naturalHeight) && naturalHeight > 0)
                label._chSingleLineHeight = naturalHeight;
        }

        /*
         * Завжди резервуємо місце максимум під 4 рядки.
         *
         * Сам StLabel більше не змінює свою висоту,
         * коли Pango переходить 1 → 2 → 3 → 4 рядки.
         */
        if (
            Number.isFinite(label._chSingleLineHeight) &&
            label._chSingleLineHeight > 0
        ) {
            label.set_height(label._chSingleLineHeight * 4);
        }

        label.clutter_text.set({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        const key = this._settings.get_string("app-grid-icon-size");

        const size =
            IconInteractionController.ICON_SIZE[key] ??
            IconInteractionController.ICON_SIZE.normal;

        label.translation_y =
            IconInteractionController.LABEL_OFFSET_Y + size / 2;

        container.queue_relayout();
        item.queue_relayout();
    }

    _installFixedIconPreferredSize(icon, size) {
        if (!icon || icon.is_destroyed?.()) return;

        if (icon._chFixedPreferredSizeInstalled) {
            icon._chFixedPreferredSize = size;
            return;
        }

        const original = icon.get_preferred_size;

        if (typeof original !== "function") return;

        icon._chOriginalGetPreferredSize = original;

        icon.get_preferred_size = function () {
            const fixedSize = this._chFixedPreferredSize;

            if (Number.isFinite(fixedSize) && fixedSize > 0)
                return [fixedSize, fixedSize, fixedSize, fixedSize];

            return this._chOriginalGetPreferredSize.call(this);
        };

        icon._chFixedPreferredSizeInstalled = true;
        icon._chFixedPreferredSize = size;
    }

    _installFixedPreferredSize(item) {
        if (item._chFixedPreferredSizeInstalled) return;

        const original = item.get_preferred_size;

        if (typeof original !== "function") return;

        item._chOriginalGetPreferredSize = original;

        item.get_preferred_size = function () {
            const size = this._chFixedPreferredSize;

            if (Number.isFinite(size) && size > 0) {
                return [size, size, size, size];
            }

            return this._chOriginalGetPreferredSize.call(this);
        };

        item._chFixedPreferredSizeInstalled = true;

        this._refreshFixedPreferredSize(item);
    }

    _refreshFixedPreferredSize(item) {
        if (!item) return;

        item._chFixedPreferredSize =
            IconInteractionController.APP_ICON_TILE_SIZE;
    }

    _ensureHoverHandler(item) {
        const icon = item?.icon?.icon;

        if (!icon) return;

        const isFolder = item.has_style_class_name?.("app-folder") === true;

        if (!isFolder) this._ensureLabelOverlay(item);

        /*
         * TEMPORARY LABEL TEST:
         *
         * Виносимо StLabel із вертикального BaseIcon._box
         * у той самий _iconContainer, де знаходиться BaseIcon.
         *
         * Таким чином label більше не є елементом vertical BoxLayout
         * і не повинен впливати на вертикальне позиціювання St.Icon.
         */
        if (
            !isFolder &&
            item.icon?.label &&
            item._iconContainer &&
            item.icon._box &&
            item.icon.label.get_parent() === item.icon._box
        ) {
            const label = item.icon.label;

            item.icon._box.remove_child(label);
            item._iconContainer.add_child(label);

            label.x_expand = true;
            label.x_align = Clutter.ActorAlign.CENTER;
            label.y_align = Clutter.ActorAlign.END;

            label.queue_relayout();
            item._iconContainer.queue_relayout();
        }

        /*
         * Якщо handler вже встановлений саме на цьому St.Icon —
         * просто гарантуємо правильний reactive-стан.
         *
         * Це важливо після штатних GNOME операцій scale/fade та DND.
         */
        if (item._chHoverInteractionInstalled && item._chHoverIcon === icon) {
            item.reactive = isFolder;
            item.track_hover = false;
            icon.reactive = true;

            return;
        }

        /*
         * GNOME міг створити новий St.Icon всередині того ж AppIcon.
         *
         * Старий hover-handler треба прибрати зі старого actor,
         * після чого встановити його на новий.
         */
        const oldIcon = item._chHoverIcon;

        if (oldIcon && oldIcon !== icon) {
            if (item._chIconEnterId) {
                oldIcon.disconnect(item._chIconEnterId);
                item._chIconEnterId = 0;
            }

            if (item._chIconLeaveId) {
                oldIcon.disconnect(item._chIconLeaveId);
                item._chIconLeaveId = 0;
            }

            if (
                item._chRightClickGesture &&
                item._chRightClickGestureActor === oldIcon
            ) {
                if (!oldIcon.is_destroyed?.())
                    oldIcon.remove_action(item._chRightClickGesture);

                item._chRightClickGesture = null;
                item._chRightClickGestureActor = null;
            }

            if (item._chDndGesture && item._chDndGestureActor === oldIcon) {
                if (!oldIcon.is_destroyed?.())
                    oldIcon.remove_action(item._chDndGesture);

                item._chDndGestureActor = null;
            }
        }

        item._chHoverInteractionInstalled = true;
        item._chHoverIcon = icon;

        item.reactive = isFolder;
        item.track_hover = false;

        item.reactive = isFolder;
        item.track_hover = false;

        icon.reactive = true;

        if (!isFolder && typeof item.activate === "function") {
            const leftClickGesture = new Clutter.ClickGesture({
                required_button: Clutter.BUTTON_PRIMARY,
            });

            leftClickGesture.connect("recognize", () => {
                if (!item.is_destroyed?.())
                    item.activate(Clutter.BUTTON_PRIMARY);
            });

            icon.add_action(leftClickGesture);

            item._chLeftClickGesture = leftClickGesture;
            item._chLeftClickGestureActor = icon;
        }

        /*
         * AppIcon у нашій схемі reactive=false, тому штатний
         * right-click gesture більше не отримує подію.
         *
         * Переносимо його поведінку на графічну іконку.
         * Лівий клік тут НЕ обробляємо — він і далі проходить
         * крізь AppIcon до фону.
         *
         * Для тек це не потрібно: FolderIcon залишається reactive=true.
         */
        if (!isFolder && typeof item.popupMenu === "function") {
            const rightClickGesture = new Clutter.ClickGesture({
                required_button: Clutter.BUTTON_SECONDARY,
                recognize_on_press: true,
            });

            rightClickGesture.connect("recognize", () => {
                if (!item.is_destroyed?.()) item.popupMenu();
            });

            icon.add_action(rightClickGesture);

            item._chRightClickGesture = rightClickGesture;
            item._chRightClickGestureActor = icon;
        }

        /*
         * Штатний GNOME DND gesture спочатку висить на AppIcon.
         *
         * AppIcon у нашій схемі reactive=false, тому gesture треба
         * перенести на графічну іконку. Сам draggable object при цьому
         * все одно має actor=AppIcon, тобто drag-source не змінюється.
         */
        const dragGesture = item?._draggable?.startGesture;

        if (dragGesture) {
            item.remove_action(dragGesture);
            icon.add_action(dragGesture);

            item._chDndGesture = dragGesture;
            item._chDndGestureActor = icon;
        }

        /*
         * Після завершення DND штатний AppViewItem.undoScaleAndFade()
         * повертає reactive=true. Нам це не можна дозволити.
         */
        if (item._draggable && !item._chDndReactiveLockId) {
            item._chDndReactiveLockId = item._draggable.connect(
                "drag-end",
                () => {
                    if (item.is_destroyed?.()) return;

                    item.reactive = isFolder;
                    item.track_hover = false;
                },
            );
        }

        this._installFixedPreferredSize(item);

        if (
            !item._chOriginalUpdateMultiline &&
            typeof item._updateMultiline === "function"
        ) {
            item._chOriginalUpdateMultiline = item._updateMultiline;
        }

        item._updateMultiline = function () {
            if (!this._expandTitleOnHover || !this.icon?.label) return;

            const label = this.icon.label;
            const clutterText = label.clutter_text;

            const expand =
                this._forcedHighlight ||
                this._chIconHovered ||
                this.has_key_focus();

            if (this._expand === expand) return;

            this._expand = expand;

            /*
             * AppIcon не обрізає свій content.
             */
            this.clip_to_allocation = false;
            this.icon.clip_to_allocation = false;

            if (this._iconContainer)
                this._iconContainer.clip_to_allocation = false;

            /*
             * ВАЖЛИВО:
             *
             * Не робимо save_easing_state(),
             * не створюємо allocation transition
             * і не анімуємо сам label allocation.
             *
             * При hover просто міняємо Pango-режим.
             */
            clutterText.set({
                line_wrap: expand,
                line_wrap_mode: expand
                    ? Pango.WrapMode.WORD_CHAR
                    : Pango.WrapMode.NONE,
                ellipsize: expand
                    ? Pango.EllipsizeMode.NONE
                    : Pango.EllipsizeMode.END,
            });
        };

        item._chIconEnterId = icon.connect("enter-event", () => {
            item._chIconHovered = true;

            const mode = this._settings.get_string("app-grid-names-visibility");
            const label = item.icon?.label;

            if (mode === "hover" && label) label.visible = true;

            item.clip_to_allocation = false;

            if (item.icon) item.icon.clip_to_allocation = false;

            if (item._iconContainer)
                item._iconContainer.clip_to_allocation = false;

            item.z_position = 0.00000001;

            item._updateMultiline();

            console.log(
                `CH-HOVER enter label="${item?.icon?.label?.text ?? "<no label>"}"`,
            );

            this._animate(item, "hover", true);

            return Clutter.EVENT_PROPAGATE;
        });

        item._chIconLeaveId = icon.connect("leave-event", () => {
            item._chIconHovered = false;

            const mode = this._settings.get_string("app-grid-names-visibility");
            const label = item.icon?.label;

            if (mode === "hover" && label) label.visible = false;

            item.z_position = 0;

            item._updateMultiline();

            console.log(
                `CH-HOVER leave label="${item?.icon?.label?.text ?? "<no label>"}"`,
            );

            this._animate(item, "hover", false);

            return Clutter.EVENT_PROPAGATE;
        });

        item.connect("destroy", () => {
            item._chHoverHandlerId = 0;
        });

        item._chPressHandlerId = item.connect("notify::pressed", () => {
            this._animate(item, "press");
        });

        item.connect("destroy", () => {
            item._chPressHandlerId = 0;
        });
    }
}
