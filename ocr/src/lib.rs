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

struct Point(f64, f64);

trait PointBuilder {
    fn new(x: f64, y: f64) -> Self;
}

impl PointBuilder for Point {
    fn new(x: f64, y: f64) -> Self {
        Point(x, y)
    }
}

struct BoundingBox {
    max_x: f64,
    min_x: f64,
    max_y: f64,
    min_y: f64,
}

trait BBBuilder {
    fn new(x1: f64, x2: f64, y1: f64, y2: f64) -> Self;
}

impl BBBuilder for BoundingBox {
    fn new(x1: f64, x2: f64, y1: f64, y2: f64) -> Self {
        BoundingBox {
            max_x: x1,
            min_x: x2,
            max_y: y1,
            min_y: y2,
        }
    }
}

struct AspectRatio {
    height: f64,
    width: f64,
    ratio: f64,
}

trait CanBox {
    fn new(w: f64, h: f64) -> Self;

    fn from_bounding_box(b: BoundingBox) -> Self;
}

impl CanBox for AspectRatio {
    fn new(w: f64, h: f64) -> Self {
        let ratio = w / h;
        AspectRatio {
            height: h,
            width: w,
            ratio,
        }
    }

    fn from_bounding_box(b: BoundingBox) -> Self {
        let height = b.max_y - b.min_y;
        let width = b.max_x - b.min_x;

        Self::new(width, height)
    }
}

struct Character {
    points: Vec<Point>,
    aspect_ratio: AspectRatio,
    bounding_box: BoundingBox,
    label: char,
}

fn euclidean_distance(p1: &Character, p2: &Character) -> f64 {
    let mut sum = 0.0;

    for Point(x1, y1) in &p1.points {
        let Point(x2, y2) = p2.points.iter().next().unwrap();
        sum += ((x1 - x2).powf(2.0) + (y1 - y2).powf(2.0)).sqrt();
    }
    sum
}

struct KnnClassifier {
    training_data: Vec<Character>,
    k: usize,
}

trait Predict {
    fn predict(&self, character: &Character) -> bool;
}

impl Predict for KnnClassifier {
    fn predict(&self, character: &Character) -> bool {
        let mut neighbors = Vec::new();

        for training_char in &self.training_data {
            let distance = euclidean_distance(character, training_char);
            neighbors.push((distance, training_char.label));
        }
        neighbors.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

        let mut is_one = 0;
        let mut not_one = 0;

        for (_, label) in neighbors.iter().take(self.k) {
            if *label == '1' {
                is_one += 1;
            } else {
                not_one += 1;
            }
        }

        is_one > not_one
    }
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
    let training_data = Vec::from([
        Character {
            bounding_box: BoundingBox::new(0.0, 200.0, 0.0, 200.0),
            aspect_ratio: AspectRatio::new(100.0, 100.0),
            label: '1',
            points: vec![
                Point::new(10.0, 10.0),
                Point::new(7.0, 8.0),
                Point::new(9.0, 7.0),
                Point::new(10.0, 12.0),
                Point::new(10.0, 14.0),
                Point::new(10.0, 16.0),
                Point::new(10.0, 18.0),
                Point::new(10.0, 20.0),
            ],
        },
        Character {
            bounding_box: BoundingBox::new(0.0, 200.0, 0.0, 200.0),
            aspect_ratio: AspectRatio::new(100.0, 100.0),
            label: '1',
            points: vec![
                Point::new(10.0, 10.0),
                Point::new(7.0, 8.0),
                Point::new(9.0, 7.0),
                Point::new(10.0, 12.0),
                Point::new(10.0, 14.0),
                Point::new(10.0, 16.0),
                Point::new(10.0, 18.0),
                Point::new(10.0, 20.0),
            ],
        },
        Character {
            bounding_box: BoundingBox::new(0.0, 200.0, 0.0, 200.0),
            aspect_ratio: AspectRatio::new(100.0, 100.0),
            label: '2',
            points: vec![
                Point::new(10.0, 10.0),
                Point::new(14.0, 8.0),
                Point::new(16.0, 7.0),
                Point::new(18.0, 10.0),
                Point::new(20.0, 14.0),
                Point::new(18.0, 16.0),
                Point::new(16.0, 18.0),
                Point::new(18.0, 18.0),
                Point::new(20.0, 18.0),
            ],
        },
        Character {
            bounding_box: BoundingBox::new(0.0, 200.0, 0.0, 200.0),
            aspect_ratio: AspectRatio::new(100.0, 100.0),
            label: '2',
            points: vec![
                Point::new(10.0, 10.0),
                Point::new(14.0, 8.0),
                Point::new(16.0, 7.0),
                Point::new(18.0, 10.0),
                Point::new(20.0, 14.0),
                Point::new(18.0, 16.0),
                Point::new(16.0, 18.0),
                Point::new(18.0, 18.0),
                Point::new(20.0, 18.0),
            ],
        },
    ]);

    let knn = KnnClassifier {
        k: 3,
        training_data,
    };

    let input_data = Character {
        bounding_box: BoundingBox::new(0.0, 200.0, 0.0, 200.0),
        aspect_ratio: AspectRatio::new(100.0, 100.0),
        label: '1',
        points: vec![
            Point::new(10.0, 10.0),
            Point::new(10.0, 12.0),
            Point::new(10.0, 14.0),
            Point::new(10.0, 16.0),
            Point::new(10.0, 18.0),
            Point::new(10.0, 20.0),
        ],
    };

    let res = knn.predict(&input_data);

    log(&res.to_string());

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
                        context.close_path();
                    }
                    "mousedown" => {
                        is_drawing = true;
                        context.begin_path();
                        context.move_to(event.offset_x() as f64, event.offset_y() as f64);
                    }
                    "mousemove" => {
                        if is_drawing == true {
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
