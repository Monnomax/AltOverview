import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Shell from "gi://Shell";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Background from "resource:///org/gnome/shell/ui/background.js";

import { GrainEffect, SaturationEffect } from "./effects.js";

export const MonitorBackground = GObject.registerClass(
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
            this._blurEffect.queue_repaint();
        }

        setGrain(percent) {
            this._grainEffect.setAmount(percent);
        }

        vfunc_destroy() {
            if (this._changedId) {
                this._bgManager.disconnect(this._changedId);
                this._changedId = 0;
            }
            this._bgManager.destroy();
            super.vfunc_destroy();
        }
    },
);
