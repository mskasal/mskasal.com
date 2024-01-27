use std::{cell::RefCell, f64::consts::PI, rc::Rc};

use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, Window};

struct Position {
    x: f64,
    y: f64,
}

struct Ball {
    position: Position,
    radius: f64,
}

impl Ball {
    fn new(x: f64, y: f64, radius: f64) -> Self {
        Ball {
            position: Position { x, y },
            radius,
        }
    }

    fn update(&mut self, new_x: f64, new_y: f64) -> &mut Self {
        self.position.x = new_x;
        self.position.y = new_y;
        self
    }
}

fn window() -> web_sys::Window {
    web_sys::window().expect("no global `window` exists")
}

fn request_animation_frame(f: &Closure<dyn FnMut()>) {
    window()
        .request_animation_frame(f.as_ref().unchecked_ref())
        .expect("should register `requestAnimationFrame` OK");
}

fn document() -> web_sys::Document {
    window()
        .document()
        .expect("should have a document on window")
}

fn body() -> web_sys::HtmlElement {
    document().body().expect("document should have a body")
}

#[wasm_bindgen(start)]
pub fn pong_game() -> Result<(), JsValue> {
    let canvas: HtmlCanvasElement = document()
        .create_element("canvas")
        .expect("Failed to create canvas")
        .dyn_into()
        .expect("Failed to convert to HtmlCanvasElement");

    canvas.set_width(500);
    canvas.set_height(400);

    body()
        .append_child(&canvas)
        .expect("Failed to append canvas");

    let f = Rc::new(RefCell::new(None));
    let g = f.clone();
    if let Ok(context) = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into::<CanvasRenderingContext2d>()
    {
        let mut ball = Ball::new(113.0, 3.0, 4.0);
        let mut dx = 3.0;
        let mut dy = 3.0;

        *g.borrow_mut() = Some(Closure::new(move || {
            context.clear_rect(0.0, 0.0, 500.0, 400.0);
            draw_ball(&ball, &context);
            ball.update(ball.position.x + dx, ball.position.y + dy);

            if ball.position.x >= 496.0 && dx > 0.0 || ball.position.x <= 0.0 && dx < -0.0 {
                dx *= -1.0;
            }

            if ball.position.y >= 396.0 && dy > 0.0 || ball.position.y <= 0.0 && dy < -0.0 {
                dy *= -1.0;
            }

            request_animation_frame(f.borrow().as_ref().unwrap());
        }));

        request_animation_frame(g.borrow().as_ref().unwrap());
    }
    Ok(())
}

fn draw_ball(ball: &Ball, context: &CanvasRenderingContext2d) {
    context.begin_path();
    context
        .arc(ball.position.x, ball.position.y, ball.radius, PI, PI / 1.5)
        .expect("Failed to draw arc");
    context.fill();
    context.close_path();
}
