from manim import *


class HelloScene(Scene):
    def construct(self):
        title = Text("Hello from manim-cli")
        subtitle = Text("Render pipeline smoke test").scale(0.6).next_to(title, DOWN)
        self.play(Write(title))
        self.play(FadeIn(subtitle))
        self.wait(1)
