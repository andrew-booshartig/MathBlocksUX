"""The xy graph's engine: what college graphing needs, each drawn as the
kind of thing it is."""

import pytest

from mathcore.graph2d import op_graph2d, op_regress


def graph(*lines, **req):
    r = op_graph2d({"exprs": list(lines), "xrange": [-30, 30], "yrange": [-10, 10], **req})
    return r


def kinds(*lines, **req):
    return [s["kind"] for s in graph(*lines, **req)["series"]]


@pytest.mark.parametrize("line,kind", [
    (r"y=2x+1", "function"), (r"y=\log_{2}(x)", "function"), (r"y=\sec(x)", "function"), (r"y=\arcsin(x)", "function"),
    (r"y=\lfloor x\rfloor", "function"), (r"y=\sum_{n=1}^{5}\frac{\sin(nx)}{n}", "function"), (r"y=\int_{0}^{x}t\,dt", "function"),
    (r"y=\begin{cases}x^{2}&x<0\\x&x\ge0\end{cases}", "function"), (r"y=x^{2}\left\{0\le x\le2\right\}", "function"),
    (r"x^{2}+y^{2}=25", "curve"), (r"x=y^{2}", "curve"), (r"x=3", "vline"), (r"y<2x+1", "inequality"), (r"x^{2}+y^{2}\le9", "region"),
    (r"r=1+\cos(\theta)", "curve"), (r"\left(\cos(t),\sin(t)\right)", "curve"), (r"\frac{dy}{dx}=x-y", "field"), (r"(1,2),(3,4)", "points"),
])
def test_each_kind_of_line_is_drawn(line, kind):
    assert kinds(line) == [kind]


def test_a_function_defined_once_is_used_by_others():
    assert kinds(r"f(x)=x^{3}-3x", r"y=f'(x)", r"g(x)=f(x)+1") == ["function", "function", "function"]


def test_points_worth_knowing():
    r = graph(r"y=\frac{x^{2}-1}{x-1}", r"y=x^{3}-3x", r"y=\frac{1}{x-2}")
    marks = {(m["kind"], m["label"]) for m in r["markers"]}
    assert ("hole", "(1, 2)") in marks
    assert ("max", "(-1, 2)") in marks and ("min", "(1, -2)") in marks
    assert r["series"][2]["asymptotes"] == [2.0]


def test_derivative_tangent_and_area_on_request():
    r = graph(r"y=x^{2}", extras=[{"derivative": True, "tangent": 1, "area": [0, 3]}])
    roles = [(s["kind"], s.get("role")) for s in r["series"]]
    assert ("function", "derivative") in roles and ("function", "tangent") in roles
    area = next(s for s in r["series"] if s["kind"] == "area")
    assert area["value"] == 9.0
    assert next(s for s in r["series"] if s.get("role") == "tangent")["slope"] == 2.0


def test_a_letter_with_no_value_asks_for_a_slider():
    s = graph(r"y=mx+b")["series"][0]
    assert s["kind"] == "error" and s["missing"] == ["b", "m"]
    assert kinds(r"y=mx+b", vars={"m": "2", "b": "1"}) == ["function"]


def test_degrees():
    r = graph(r"y=\sin(x)", degrees=True, window={"xmin": -360, "xmax": 360, "ymin": -2, "ymax": 2}, xrange=[-1080, 1080], yrange=[-2, 2])
    xs = [m["x"] for m in r["markers"] if m["kind"] == "x-intercept"]
    assert any(abs(x - 180) < 1e-6 for x in xs)


def test_regression():
    assert op_regress({"points": [[0, 1], [1, 3], [2, 5]], "model": "linear"}) == {"latex": "y=2x+1", "r2": 1.0}
    exp = op_regress({"points": [[0, 2], [1, 6], [2, 18]], "model": "exponential"})
    assert exp["r2"] == 1.0 and exp["latex"] == r"y=2\cdot3^{x}"


# ---- geometry: points by name, and what's built on them

GEO = {"window": {"xmin": -10, "xmax": 10, "ymin": -10, "ymax": 10}, "latex": True}
A, B, C = r"A=\left(1,2\right)", r"B=\left(4,\frac{13}{2}\right)", r"C=\left(-3,1\right)"


def shapes(*lines):
    return {s["index"]: s for s in graph(*lines, **GEO)["series"] if not s.get("role")}


def test_named_points_are_labelled_and_used_by_shapes_in_any_order():
    s = shapes(r"\operatorname{segment}\left(A,B\right)", A, B)
    assert (s[1]["name"], s[2]["name"]) == ("A", "B")
    assert s[0]["shape"] == "segment" and s[0]["x"] == [1.0, 4.0] and s[0]["y"] == [2.0, 6.5]


def test_each_shape_says_what_is_true_about_it_exactly():
    s = shapes(A, B, C, r"segment(A,B)", r"line(A,B)", r"ray(B,A)", r"polygon(A,B,C)", r"circle(A,B)", r"vector(C,A)")
    assert s[3]["facts"] == [r"\text{length }\frac{3\sqrt{13}}{2}\approx5.408", r"y=\frac{3}{2}x+\frac{1}{2}\ \left\{1\le x\le4\right\}"]
    assert s[4]["facts"] == [r"y=\frac{3}{2}x+\frac{1}{2}"]
    assert s[5]["facts"] == [r"y=\frac{3}{2}x+\frac{1}{2}\ \left\{x\le 4\right\}"]
    assert s[6]["kind"] == "polygon" and s[6]["facts"][0] == r"\text{area }\frac{15}{2}\approx7.5"
    assert s[7]["facts"][0] == r"\left(x-1\right)^{2}+\left(y-2\right)^{2}=\frac{117}{4}"
    assert s[8]["arrow"] and s[8]["facts"][0] == r"\left\langle4,1\right\rangle"


def test_midpoint_perpendicular_parallel_and_distance():
    s = shapes(A, B, C, r"M=\operatorname{midpoint}\left(A,B\right)", r"perpendicular(segment(A,B),M)", r"parallel(line(A,B),C)", r"distance(A,B)", r"x=A.x")
    assert (s[3]["x"], s[3]["y"], s[3]["name"]) == ([2.5], [4.25], "M")
    assert s[4]["facts"] == [r"y=-\frac{2}{3}x+\frac{71}{12}"]
    assert s[5]["facts"] == [r"y=\frac{3}{2}x+\frac{11}{2}"]
    assert s[6]["kind"] == "value" and s[6]["facts"] == [r"=\frac{3\sqrt{13}}{2}\approx5.408"]
    assert s[7]["kind"] == "vline" and s[7]["x0"] == 1.0


def test_a_whole_line_gets_intercepts_and_crossings():
    marks = graph(A, B, r"line(A,B)", r"y=x^{2}-4", **GEO)["markers"]
    assert ("y-intercept", 2, "(0, 0.5)") in [(m["kind"], m["series"], m["label"]) for m in marks]
    assert sorted(m["label"] for m in marks if m["kind"] == "intersection") == ["(-1.5, -1.75)", "(3, 5)"]


def test_geometry_mistakes_are_said_plainly():
    s = shapes(A, B, r"segment(A,A)", r"polygon(A,B)", r"circle(A,0)", r"line(A)", r"segment(A,D)")
    assert "same point" in s[2]["error"]
    assert "three points" in s[3]["error"]
    assert "radius" in s[4]["error"]
    assert "two points" in s[5]["error"]
    assert s[6]["kind"] == "error"


def test_calculus_facts_are_exact():
    out = graph(r"y=x^{2}-4", extras=[{"derivative": True, "tangent": 1, "area": [0, 2]}], **GEO)["series"]
    facts = {s.get("role") or s["kind"]: s.get("facts") for s in out}
    assert facts["derivative"] == ["y'=2 x"]
    assert facts["tangent"] == [r"\text{tangent at }x=1:\ y=2x-5"]
    assert facts["area"] == [r"\int_{0}^{2}y\,dx=-\frac{16}{3}\approx-5.333"]
