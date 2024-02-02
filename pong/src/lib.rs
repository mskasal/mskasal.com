use std::{cell::RefCell, f64::consts::PI, rc::Rc};
use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

const G_WIDTH: u32 = 500;
const G_HEIGHT: u32 = 300;
const PADDLE_WIDTH: f64 = 12.0;
const PADDLE_HEIGHT: f64 = 80.0;
const BALL_RADIUS: f64 = 6.0;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

enum Direction {
    Up,
    Down,
}

enum Side {
    Left,
    Right,
}

struct Position {
    x: f64,
    y: f64,
}

trait Distance {
    fn distance_from(&self, other_position: &Position) -> f64;
}

impl Position {
    fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

impl Distance for Position {
    fn distance_from(&self, other: &Position) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
    }
}

trait Update {
    fn update(&mut self, new_x: f64, new_y: f64) -> &mut Self;
}

impl Update for Position {
    fn update(&mut self, new_x: f64, new_y: f64) -> &mut Self {
        self.x = new_x;
        self.y = new_y;
        self
    }
}

struct Line {
    p1: Position,
    p2: Position,
}

impl Collide for Line {
    fn collide_with_ball(&self, ball: &Ball) -> bool {
        ball.position.distance_from(&self.p1) + ball.position.distance_from(&self.p2)
            > self.p1.distance_from(&self.p2) - (ball.radius / 2.0)
            && ball.position.distance_from(&self.p1) + ball.position.distance_from(&self.p2)
                < self.p1.distance_from(&self.p2) + (ball.radius / 2.0)
    }
}

trait Collide {
    fn collide_with_ball(&self, ball: &Ball) -> bool;
}

struct Constraints {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

trait Draw {
    fn draw(&mut self, context: &CanvasRenderingContext2d);
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
        self.position.update(new_x, new_y);
        self
    }
}

impl Draw for Ball {
    fn draw(&mut self, context: &CanvasRenderingContext2d) {
        context.begin_path();
        context
            .arc(self.position.x, self.position.y, self.radius, 0.0, PI * 2.0)
            .expect("Failed to draw arc");
        context.fill();
        context.close_path();
    }
}

struct Paddle {
    position: Position,
    width: f64,
    height: f64,
    side: Side,
    collision_line: Line,
}

impl Paddle {
    fn new(position: Position, width: f64, height: f64, side: Side) -> Self {
        let collision_line =
            Self::create_collision_line(&side, &position.x, &position.y, &width, &height);
        Self {
            position,
            width,
            height,
            side,
            collision_line,
        }
    }
    fn update(&mut self, new_x: f64, new_y: f64) -> &mut Self {
        let collision_line =
            Self::create_collision_line(&self.side, &new_x, &new_y, &self.width, &self.height);
        self.collision_line = collision_line;
        self.position.update(new_x, new_y);
        self
    }
    fn create_collision_line(side: &Side, x: &f64, y: &f64, width: &f64, height: &f64) -> Line {
        match side {
            Side::Left => Line {
                p1: Position::new(x + width, *y),
                p2: Position::new(x + width, y + height),
            },
            Side::Right => Line {
                p1: Position::new(*x, *y),
                p2: Position::new(*x, y + height),
            },
        }
    }
}

impl Draw for Paddle {
    fn draw(&mut self, context: &CanvasRenderingContext2d) {
        context.begin_path();
        context.rect(self.position.x, self.position.y, self.width, self.height);
        context.fill();
        context.close_path();
    }
}

struct Score {
    position: Position,
    value: u32,
}

impl Draw for Score {
    fn draw(&mut self, context: &CanvasRenderingContext2d) {
        context.set_fill_style(&JsValue::from_str("black"));
        context.set_font("20px HackNerdFont");
        context
            .fill_text(&self.value.to_string(), self.position.x, self.position.y)
            .expect("Failed to fill score");
    }
}

#[derive(Eq, Hash, PartialEq)]
struct Player {
    connection: Connection,
    id: u32,
}

#[derive(Eq, Hash, PartialEq)]
enum Connection {
    Estabilshed,
    Nope,
}

struct PongGame {
    ball: Ball,
    ball_direction_x: f64,
    ball_direction_y: f64,
    paddles: (Paddle, Paddle),
    players: (Player, Player),
    speed: f64,
    scores: (Score, Score),
    constraints: Constraints,
    collision_lines: (Line, Line),
}

impl PongGame {
    fn new(constraints: Constraints) -> Self {
        let ball = Ball::new(15.0, 50.0, BALL_RADIUS);

        let player_one = Player {
            id: 1,
            connection: Connection::Nope,
        };
        let player_two = Player {
            id: 2,
            connection: Connection::Nope,
        };

        let paddle_one = Paddle::new(
            Position::new(constraints.x1, constraints.y1 + 10.0),
            PADDLE_WIDTH,
            PADDLE_HEIGHT,
            Side::Left,
        );
        let paddle_two = Paddle::new(
            Position::new(
                constraints.x2 - PADDLE_WIDTH,
                constraints.y2 - PADDLE_HEIGHT - 10.0,
            ),
            PADDLE_WIDTH,
            PADDLE_HEIGHT,
            Side::Right,
        );

        let score_1 = Score {
            value: 5,
            position: Position::new(
                (constraints.x1 + constraints.x2) / 2.0 - 50.0,
                constraints.y1 + 30.0,
            ),
        };

        let score_2 = Score {
            value: 5,
            position: Position::new(
                (constraints.x1 + constraints.x2) / 2.0 + 50.0,
                constraints.y1 + 30.0,
            ),
        };

        let collision_line1 = Line {
            p1: Position::new(constraints.x1, constraints.y1),
            p2: Position::new(constraints.x1, constraints.y2),
        };
        let collision_line2 = Line {
            p1: Position::new(constraints.x2, constraints.y1),
            p2: Position::new(constraints.x2, constraints.y2),
        };

        PongGame {
            ball,
            scores: (score_1, score_2),
            paddles: (paddle_one, paddle_two),
            players: (player_one, player_two),
            speed: 3.0,
            constraints,
            ball_direction_x: 1.0,
            ball_direction_y: 1.0,
            collision_lines: (collision_line1, collision_line2),
        }
    }

    fn move_ball(&mut self) {
        let mut new_x: f64 = 0.0;
        let mut new_y: f64 = 0.0;

        let is_0_collide = self.paddles.0.collision_line.collide_with_ball(&self.ball);
        let is_1_collide = self.paddles.1.collision_line.collide_with_ball(&self.ball);
        let is_left_line_collide = self.collision_lines.0.collide_with_ball(&self.ball);
        let is_right_line_collide = self.collision_lines.1.collide_with_ball(&self.ball);

        if is_0_collide && self.ball_direction_x < 0.0 {
            self.ball_direction_x *= -1.0;
        }
        if is_left_line_collide && self.ball_direction_x < 0.0 {
            self.scores.0.value -= 1;
        }
        if is_1_collide && self.ball_direction_x > 0.0 {
            self.ball_direction_x *= -1.0;
        }
        if is_right_line_collide && self.ball_direction_x > 0.0 {
            self.scores.1.value -= 1;
        }

        if self.ball.position.y <= self.constraints.y1 && self.ball_direction_y < 0.0
            || self.ball.position.y >= self.constraints.y2 && self.ball_direction_y > 0.0
        {
            self.ball_direction_y *= -1.0;
        }

        new_x += self.speed * self.ball_direction_x + self.ball.position.x;
        new_y += self.speed * self.ball_direction_y + self.ball.position.y;
        self.ball.update(new_x, new_y);
    }

    fn move_paddle(&mut self, direction: Direction, paddle: usize) {
        match paddle {
            0 => {
                let new_x = self.paddles.0.position.x;
                match direction {
                    Direction::Down => {
                        let new_y = self.paddles.0.position.y + self.speed * 5.0;
                        if self.constraints.y2 - PADDLE_HEIGHT >= new_y {
                            self.paddles.0.update(new_x, new_y);
                        }
                    }
                    Direction::Up => {
                        let new_y = self.paddles.0.position.y - self.speed * 5.0;
                        if self.constraints.y1 <= new_y {
                            self.paddles.0.update(new_x, new_y);
                        }
                    }
                }
            }
            1 => {
                let new_x = self.paddles.1.position.x;
                match direction {
                    Direction::Down => {
                        let new_y = self.paddles.1.position.y + self.speed * 5.0;
                        if self.constraints.y2 - PADDLE_HEIGHT >= new_y {
                            self.paddles.1.update(new_x, new_y);
                        }
                    }
                    Direction::Up => {
                        let new_y = self.paddles.1.position.y - self.speed * 5.0;
                        if self.constraints.y1 <= new_y {
                            self.paddles.1.update(new_x, new_y);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

impl Draw for PongGame {
    fn draw(&mut self, context: &CanvasRenderingContext2d) {
        self.ball.draw(context);
        self.paddles.0.draw(context);
        self.paddles.1.draw(context);
        self.scores.0.draw(context);
        self.scores.1.draw(context);
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
    let constraints = Constraints {
        x1: 0.0,
        x2: G_WIDTH as f64,
        y1: 0.0,
        y2: G_HEIGHT as f64,
    };

    let game = Rc::new(RefCell::new(PongGame::new(constraints)));

    let game_keydown = Rc::clone(&game);

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
        .get_element_by_id("pong")
        .expect("No element found by ID 'pong'")
        .append_child(&canvas)
        .expect("Failed to append game")
        .set_text_content(Some("Pong suppsoe to be init in here!"));

    let closure = Closure::wrap(Box::new(move |event: web_sys::KeyboardEvent| {
        let mut game = game_keydown.borrow_mut();
        match event.key().as_str() {
            "ArrowUp" => game.move_paddle(Direction::Up, 1),
            "ArrowDown" => game.move_paddle(Direction::Down, 1),
            "j" => game.move_paddle(Direction::Up, 0),
            "k" => game.move_paddle(Direction::Down, 0),
            _ => (),
        }
    }) as Box<dyn FnMut(_)>);

    body().add_event_listener_with_callback("keydown", closure.as_ref().unchecked_ref())?;

    closure.forget();

    let game_animation = Rc::clone(&game);
    let f = Rc::new(RefCell::new(None));
    let g = f.clone();
    if let Ok(context) = canvas
        .get_context("2d")
        .unwrap()
        .unwrap()
        .dyn_into::<CanvasRenderingContext2d>()
    {
        *g.borrow_mut() = Some(Closure::new(move || {
            let mut game = game_animation.borrow_mut();
            context.clear_rect(
                game.constraints.x1,
                game.constraints.y1,
                game.constraints.x2,
                game.constraints.y2,
            );

            game.move_ball();
            game.draw(&context);
            request_animation_frame(f.borrow().as_ref().unwrap());
        }));

        request_animation_frame(g.borrow().as_ref().unwrap());
    }
    Ok(())
}
