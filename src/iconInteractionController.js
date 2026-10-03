import Pango from "gi://Pango";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { IconAnimator } from "./iconAnimations.js";
import { RunningIndicators } from "./runningIndicators.js";

function openDesktopFileForIcon(item) {
    const appInfo = item?.app?.get_app_info?.();
    const filename = appInfo?.get_filename?.();
    if (!filename) return;

    try {
        const uri = Gio.File.new_for_path(filename).get_uri();
        Gio.AppInfo.launch_default_for_uri(uri, null);
    } catch (error) {
        logError(error, `Could not open desktop file: ${filename}`);
    }
}

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

    static TILE_REFERENCE_SCALE = 1.5;

    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._runningIndicators = new RunningIndicators();
        this._openDesktopFileMenuChangedId = settings.connect(
            "changed::app-grid-show-open-desktop-file",
            () => this._updateOpenDesktopFileMenuItems(),
        );
    }

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

        this._installFixedPreferredSize(item);

        return IconInteractionController.APP_ICON_TILE_SIZE;
    }

    applyIconSize(item, _baseSize = null) {
        const icon = item?.icon?.icon;
        if (!icon || icon.is_destroyed?.()) return;

        const key = this._settings.get_string("app-grid-icon-size");

        const size =
            IconInteractionController.ICON_SIZE[key] ??
            IconInteractionController.ICON_SIZE.normal;

        this._installFixedIconPreferredSize(icon, size);

        icon._chIconSizeScale = 1.0;

        icon.icon_size = Math.round(
            size * IconInteractionController.ICON_TEXTURE_OVERSAMPLE,
        );

        icon.set_size(size, size);

        icon.set_pivot_point(0.5, 0.5);

        this._runningIndicators.ensureOverlay(item, size);

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
    }

    disable() {
        const grid = this._appDisplay?._grid;

        if (this._openDesktopFileMenuChangedId) {
            this._settings.disconnect(this._openDesktopFileMenuChangedId);
            this._openDesktopFileMenuChangedId = 0;
        }

        if (!grid) return;

        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);

            if (item._chOpenDesktopFileMenuItem)
                item._chOpenDesktopFileMenuItem.visible = false;

            if (item._chOriginalPopupMenu) {
                if (item._chPopupMenuHadOwnProperty)
                    item.popupMenu = item._chOriginalPopupMenu;
                else
                    delete item.popupMenu;

                delete item._chOriginalPopupMenu;
                delete item._chPopupMenuHadOwnProperty;
            }

            const label = item?.icon?.label;
            const baseIcon = item?.icon;
            const iconBin = baseIcon?._iconBin;
            const icon = baseIcon?.icon;

            if (
                label &&
                baseIcon?._box &&
                label.get_parent() === item?._iconContainer
            ) {
                item._iconContainer.remove_child(label);
                baseIcon._box.add_child(label);

                label.set_width(-1);
                label.translation_y = 0;

                label.x_align = Clutter.ActorAlign.FILL;
                label.y_align = Clutter.ActorAlign.FILL;

                label.x_expand = false;
                label.y_expand = false;

                label.clip_to_allocation = true;

                baseIcon._box.queue_relayout();
            }

            if (label) label.visible = true;

            this._runningIndicators.restore(item, icon, iconBin);

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

            if (
                item._chRightClickGesture &&
                item._chRightClickGestureActor &&
                !item._chRightClickGestureActor.is_destroyed?.()
            ) {
                item._chRightClickGestureActor.remove_action(
                    item._chRightClickGesture,
                );
            }

            if (
                item._chMiddleClickGesture &&
                item._chMiddleClickGestureActor &&
                !item._chMiddleClickGestureActor.is_destroyed?.()
            ) {
                item._chMiddleClickGestureActor.remove_action(
                    item._chMiddleClickGesture,
                );
            }

            item._chMiddleClickGesture = null;
            item._chMiddleClickGestureActor = null;

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

            if (item._chDndGesture) {
                const gesture = item._chDndGesture;
                const gestureActor = item._chDndGestureActor;

                if (gestureActor && !gestureActor.is_destroyed?.()) {
                    gestureActor.remove_action(gesture);
                }

                item.add_action(gesture);

                item._chDndGesture = null;
                item._chDndGestureActor = null;
            }

            if (item._chDndReactiveLockId) {
                item._draggable?.disconnect(item._chDndReactiveLockId);

                item._chDndReactiveLockId = 0;
            }

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

            if (item._chHoverHandlerId) {
                item.disconnect(item._chHoverHandlerId);
                item._chHoverHandlerId = 0;
            }

            if (item._chPressHandlerId) {
                item.disconnect(item._chPressHandlerId);
                item._chPressHandlerId = 0;
            }

            if (item._chOriginalUpdateMultiline) {
                item._updateMultiline = item._chOriginalUpdateMultiline;

                item._chOriginalUpdateMultiline = null;
            }

            if (item._chFixedPreferredSizeInstalled) {
                item.get_preferred_size = item._chOriginalGetPreferredSize;

                item._chOriginalGetPreferredSize = null;
                item._chFixedPreferredSize = null;
                item._chFixedPreferredSizeInstalled = false;
            }

            item.clip_to_allocation = true;

            if (baseIcon) baseIcon.clip_to_allocation = true;

            if (baseIcon?._iconBin) baseIcon._iconBin.clip_to_allocation = true;

            if (icon) icon.clip_to_allocation = true;

            if (item._iconContainer)
                item._iconContainer.clip_to_allocation = true;

            item.z_position = 0;
        }
    }

    _animate(item, kind, activeOverride = null) {
        const icon = item?.icon?.icon;
        if (!icon) return;

        const animationActor = item?._chRunningOverlay ?? icon;

        const active =
            activeOverride !== null
                ? activeOverride
                : kind === "press"
                  ? item.pressed
                  : item.hover;

        const prefix =
            kind === "press" ? "app-grid-icon-press" : "app-grid-icon-hover";

        const curveName = this._settings.get_string(`${prefix}-curve`);

        IconAnimator.scale(animationActor, {
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

    _ensureLabelOverlay(item) {
        const baseIcon = item?.icon;
        const label = baseIcon?.label;
        const container = item?._iconContainer;
        const icon = baseIcon?.icon;

        if (!label || !container || !icon) return;

        if (label.get_parent() !== container) {
            const parent = label.get_parent();

            if (parent) parent.remove_child(label);

            container.add_child(label);
        }

        label.x_expand = false;
        label.y_expand = false;

        label.x_align = Clutter.ActorAlign.CENTER;
        label.y_align = Clutter.ActorAlign.START;

        const labelWidth = IconInteractionController.APP_ICON_TILE_SIZE;

        label.set_width(labelWidth);

        label.clip_to_allocation = false;

        if (!label._chSingleLineHeight) {
            const [, naturalHeight] = label.get_preferred_height(labelWidth);

            if (Number.isFinite(naturalHeight) && naturalHeight > 0)
                label._chSingleLineHeight = naturalHeight;
        }

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

    _closeActiveAppWindow(item) {
        const app = item?.app;
        const focusedWindow = global.display?.focus_window;

        if (!app || !focusedWindow) return;

        const windows = app.get_windows?.() ?? [];

        if (!windows.includes(focusedWindow)) return;

        if (!focusedWindow.can_close?.()) return;

        focusedWindow.delete(global.get_current_time());
    }

    _ensureOpenDesktopFileMenuHook(item) {
        if (item._chOriginalPopupMenu || typeof item.popupMenu !== "function")
            return;

        item._chPopupMenuHadOwnProperty = Object.prototype.hasOwnProperty.call(
            item,
            "popupMenu",
        );
        item._chOriginalPopupMenu = item.popupMenu;

        const controller = this;
        const originalPopupMenu = item._chOriginalPopupMenu;
        item.popupMenu = function (...args) {
            const result = originalPopupMenu.apply(this, args);
            controller._ensureOpenDesktopFileMenu(this);
            return result;
        };
    }

    _ensureOpenDesktopFileMenu(item) {
        const menu = item?._menu;
        if (!menu) return;

        const enabled = this._settings.get_boolean(
            "app-grid-show-open-desktop-file",
        );

        if (!item._chOpenDesktopFileMenuItem && !enabled) return;

        if (item._chOpenDesktopFileMenu !== menu) {
            const menuItem = new PopupMenu.PopupMenuItem("Відкрити .desktop");
            menuItem.connect("activate", () => {
                openDesktopFileForIcon(item);
                Main.overview.hide();
            });
            menu.addMenuItem(menuItem);

            item._chOpenDesktopFileMenu = menu;
            item._chOpenDesktopFileMenuItem = menuItem;
        }

        item._chOpenDesktopFileMenuItem.visible = enabled;
    }

    _updateOpenDesktopFileMenuItems() {
        const grid = this._appDisplay?._grid;
        if (!grid) return;

        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);
            if (
                item?._menu &&
                !item.has_style_class_name?.("app-folder")
            ) {
                this._ensureOpenDesktopFileMenu(item);
            }
        }
    }

    _ensureHoverHandler(item) {
        const icon = item?.icon?.icon;

        if (!icon) return;

        this._runningIndicators.ensureOverlay(item);

        const isFolder = item.has_style_class_name?.("app-folder") === true;

        if (!isFolder) {
            this._ensureLabelOverlay(item);
            this._ensureOpenDesktopFileMenuHook(item);
        }

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

        if (item._chHoverInteractionInstalled && item._chHoverIcon === icon) {
            item.reactive = isFolder;
            item.track_hover = false;
            icon.reactive = true;

            return;
        }

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

        if (!isFolder) {
            const middleClickGesture = new Clutter.ClickGesture({
                required_button: Clutter.BUTTON_MIDDLE,
                recognize_on_press: true,
            });

            middleClickGesture.connect("recognize", () => {
                if (!item.is_destroyed?.()) this._closeActiveAppWindow(item);
            });

            icon.add_action(middleClickGesture);

            item._chMiddleClickGesture = middleClickGesture;
            item._chMiddleClickGestureActor = icon;
        }

        const dragGesture = item?._draggable?.startGesture;

        if (dragGesture) {
            item.remove_action(dragGesture);
            icon.add_action(dragGesture);

            item._chDndGesture = dragGesture;
            item._chDndGestureActor = icon;
        }

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

            this.clip_to_allocation = false;
            this.icon.clip_to_allocation = false;

            if (this._iconContainer)
                this._iconContainer.clip_to_allocation = false;

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

            this._animate(item, "hover", false);

            return Clutter.EVENT_PROPAGATE;
        });

        item._chPressHandlerId = item.connect("notify::pressed", () => {
            this._animate(item, "press");
        });
    }
}
