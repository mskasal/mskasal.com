use wasm_bindgen::prelude::*;
use web_sys::{js_sys, CanvasRenderingContext2d, HtmlCanvasElement};

#[wasm_bindgen]
pub fn explode_letter(letter: char) {
    let window = web_sys::window().expect("Failed to get window");
    let document = window.document().expect("Failed to get document");

    let canvas: HtmlCanvasElement = document
        .create_element("canvas")
        .expect("Failed to create canvas")
        .dyn_into()
        .expect("Failed to convert to HtmlCanvasElement");

    canvas.set_width(400);
    canvas.set_height(200);
    document
        .body()
        .expect("Failed to get body")
        .append_child(&canvas)
        .expect("Failed to append canvas");

    if let Ok(context) = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into::<CanvasRenderingContext2d>()
    {
        particle_explosion(&context, letter);
    }
}

fn particle_explosion(context: &CanvasRenderingContext2d, letter: char) {
    context.clear_rect(0.0, 0.0, 400.0, 200.0);

    let num_particles = 100;
    let particle_size = 3.0;
    let explosion_force = 5.0;
    let center_x = 200.0;
    let center_y = 100.0;

    for _ in 0..num_particles {
        let angle = js_sys::Math::random() * std::f64::consts::PI * 2.0;
        let distance = js_sys::Math::random() * explosion_force;

        let particle_x = center_x + distance * angle.cos();
        let particle_y = center_y + distance * angle.sin();

        let color = format!(
            "rgb({}, {}, {})",
            (js_sys::Math::random() * 255.0) as u8,
            (js_sys::Math::random() * 255.0) as u8,
            (js_sys::Math::random() * 255.0) as u8
        );

        context.set_fill_style(&JsValue::from_str(&color));
        context.begin_path();
        context
            .arc(
                particle_x,
                particle_y,
                particle_size,
                0.0,
                2.0 * std::f64::consts::PI,
            )
            .expect("Failed to draw arc");
        context.fill();
    }

    context.set_fill_style(&JsValue::from_str("red"));
    context.set_font("30px HackNerdFont");
    context
        .fill_text(&letter.to_string(), center_x - 10.0, center_y + 10.0)
        .expect("Failed to fill text");
}
