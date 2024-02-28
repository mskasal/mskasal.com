use std::{cell::RefCell, rc::Rc};

use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

const G_WIDTH: u32 = 500;
const G_HEIGHT: u32 = 300;

#[derive(Debug, Copy, Clone)]
struct Color {
    red: u8,
    green: u8,
    blue: u8,
}

impl Color {
    fn new(red: u8, green: u8, blue: u8) -> Self {
        Self { red, green, blue }
    }

    fn default() -> Self {
        Self {
            red: 0,
            blue: 0,
            green: 0,
        }
    }

    fn random() -> Self {
        use rand::Rng;

        let mut rng = rand::thread_rng();
        Self {
            red: rng.gen_range(0, 255),
            green: rng.gen_range(0, 255),
            blue: rng.gen_range(0, 255),
        }
    }
}

struct Position {
    x: f64,
    y: f64,
}

impl Position {
    fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

trait Area {
    fn area(&self) -> f64;
}

struct Pixel {
    position: Position,
    size: f64,
    color: Color,
}

impl Area for Pixel {
    fn area(&self) -> f64 {
        self.size.powf(2.0)
    }
}

impl Pixel {
    fn new(position: Position, color: Color, size: f64) -> Self {
        Self {
            position,
            color,
            size,
        }
    }

    fn _set_color(&mut self, new_color: Color) {
        self.color = new_color;
    }
}

impl Draw for Pixel {
    fn draw(&mut self, context: &CanvasRenderingContext2d) {
        context.begin_path();
        context.rect(self.position.x, self.position.y, self.size, self.size);
        context.set_fill_style(
            &format!(
                "rgb({}, {}, {})",
                self.color.red, self.color.green, self.color.blue
            )
            .into(),
        );

        context.fill();
        context.stroke_rect(self.position.x, self.position.y, self.size, self.size);
        context.set_line_width(4.0);
        context.set_stroke_style(&"#fff883".to_string().into());
        context.fill();
        context.close_path();
    }
}

struct Constraints {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Area for Constraints {
    fn area(&self) -> f64 {
        (self.x2 - self.x1) * (self.y2 - self.y1)
    }
}

trait Draw {
    fn draw(&mut self, context: &CanvasRenderingContext2d);
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
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
pub fn led_matrix() -> Result<(), JsValue> {
    let constraints = Constraints {
        x1: 0.0,
        x2: G_WIDTH as f64,
        y1: 0.0,
        y2: G_HEIGHT as f64,
    };

    let canvas: HtmlCanvasElement = document()
        .create_element("canvas")
        .expect("Failed to create canvas")
        .dyn_into()
        .expect("Failed to convert to HtmlCanvasElement");

    canvas.set_width(G_WIDTH);
    canvas.set_height(G_HEIGHT);

    body()
        .owner_document()
        .expect("No owner document found")
        .get_element_by_id("led_matrix")
        .expect("No element found by ID 'led_matrix'")
        .append_child(&canvas)
        .expect("Failed to append led_matrix")
        .set_text_content(Some("led_matrix suppose to be init in here!"));

    let f = Rc::new(RefCell::new(None));
    let g = f.clone();
    if let Ok(context) = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into::<CanvasRenderingContext2d>()
    {
        let closure =
            Closure::wrap(Box::new(move |event: web_sys::MouseEvent| {}) as Box<dyn FnMut(_)>);

        canvas.add_event_listener_with_callback("mousedown", closure.as_ref().unchecked_ref())?;
        canvas.add_event_listener_with_callback("mousemove", closure.as_ref().unchecked_ref())?;
        canvas.add_event_listener_with_callback("mouseup", closure.as_ref().unchecked_ref())?;

        closure.forget();

        *g.borrow_mut() = Some(Closure::new(move || {
            context.clear_rect(
                constraints.x1,
                constraints.y1,
                constraints.x2,
                constraints.y2,
            );

            for i in 0..=30 {
                for j in 0..=50 {
                    let mut n_pixel = Pixel::new(
                        Position::new(j as f64 * 10.0, i as f64 * 10.0),
                        Color::random(),
                        10.0,
                    );
                    n_pixel.draw(&context);
                }
            }

            request_animation_frame(f.borrow().as_ref().unwrap());
        }));

        request_animation_frame(g.borrow().as_ref().unwrap());
    }
    Ok(())
}
