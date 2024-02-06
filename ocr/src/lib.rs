use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

const G_WIDTH: u32 = 500;
const G_HEIGHT: u32 = 300;

struct Constraints {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
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
pub fn ocr() -> Result<(), JsValue> {
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
        .get_element_by_id("ocr")
        .expect("No element found by ID 'ocr'")
        .append_child(&canvas)
        .expect("Failed to append ocr")
        .set_text_content(Some("Ocr suppose to be init in here!"));
    // let f = Rc::new(RefCell::new(None));
    // let g = f.clone();
    if let Ok(context) = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into::<CanvasRenderingContext2d>()
    {
        context.clear_rect(
            constraints.x1,
            constraints.y1,
            constraints.x2,
            constraints.y2,
        );

        let mut is_drawing: bool = false;
        let closure =
            Closure::wrap(Box::new(
                move |event: web_sys::MouseEvent| match event.type_().as_str() {
                    "mouseup" => {
                        is_drawing = false;
                    }
                    "mousedown" => {
                        is_drawing = true;
                        context.begin_path();
                        context.move_to(event.offset_x() as f64, event.offset_y() as f64);
                    }
                    "mousemove" => {
                        if is_drawing == true {
                            log(format!(
                                "mouse moving x: {}, y: {}, x-os:{}, y-os:{}, type: {}",
                                event.x().to_string(),
                                event.y().to_string(),
                                event.offset_x().to_string(),
                                event.offset_y().to_string(),
                                event.type_()
                            )
                            .as_str());
                            context.line_to((event.offset_x()) as f64, (event.offset_y()) as f64);
                            context.stroke();
                        }
                    }
                    _ => {}
                },
            ) as Box<dyn FnMut(_)>);

        canvas.add_event_listener_with_callback("mousedown", closure.as_ref().unchecked_ref())?;
        canvas.add_event_listener_with_callback("mousemove", closure.as_ref().unchecked_ref())?;
        canvas.add_event_listener_with_callback("mouseup", closure.as_ref().unchecked_ref())?;

        closure.forget();

        // *g.borrow_mut() = Some(Closure::new(move || {
        //
        //     request_animation_frame(f.borrow().as_ref().unwrap());
        // }));
        //
        // request_animation_frame(g.borrow().as_ref().unwrap());
    }
    Ok(())
}
