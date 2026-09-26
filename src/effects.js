import Cogl from "gi://Cogl";
import GObject from "gi://GObject";
import Shell from "gi://Shell";

export const SaturationEffect = GObject.registerClass(
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

export const GrainEffect = GObject.registerClass(
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
