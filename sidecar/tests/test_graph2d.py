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


def test_angles_exact_with_a_square_corner_at_90():
    pts = [r"A=\left(4,0\right)", r"B=\left(0,0\right)", r"C=\left(0,3\right)", r"D=\left(3,3\right)"]
    s = shapes(*pts, r"angle(A,B,C)", r"angle(A,B,D)", r"angle(C,A,B)", r"angle(A,A,B)")
    assert s[4]["facts"] == [r"\angle=90^{\circ}=\frac{\pi}{2}"] and len(s[4]["x"]) == 3 and s[4]["label"]["text"] == "90°"
    assert s[5]["facts"] == [r"\angle=45^{\circ}=\frac{\pi}{4}"]
    assert s[6]["facts"] == [r"\angle\approx36.87^{\circ}"]
    assert "three different points" in s[7]["error"]


def test_straight_lines_offer_two_points_to_build_from():
    s = shapes(r"y=2x+1", r"x=\frac{3}{2}", r"y=x^{2}")
    assert s[0]["through"] == [r"\left(0,1\right)", r"\left(1,3\right)"]
    assert s[1]["through"] == [r"\left(\frac{3}{2},0\right)", r"\left(\frac{3}{2},1\right)"]
    assert "through" not in s[2]
    p = shapes(r"D=\left(3,3\right)", r"perpendicular(line((0,1),(1,3)),D)", r"parallel(line((0,1),(1,3)),D)")
    assert p[1]["facts"] == [r"y=-\frac{1}{2}x+\frac{9}{2}"] and p[2]["facts"] == [r"y=2x-3"]


def test_log_axes_sample_in_powers_of_ten():
    out = graph(r"y=x^{2}", r"x^{2}+y^{2}=4", latex=True, window={"xmin": 0.1, "xmax": 100, "ymin": 0.1, "ymax": 100}, log={"x": True, "y": True}, xrange=[0.01, 1000])["series"]
    xs = out[0]["x"]
    assert xs[0] == pytest.approx(0.01) and xs[2] / xs[1] == pytest.approx(xs[1] / xs[0], rel=1e-3)
    assert out[1]["kind"] == "curve"


@pytest.mark.parametrize("latex,expected", [
    (r"y=\frac23x", "2*x/3"), (r"y=x^23", "3*x**2"), (r"y=\sqrt2x", "sqrt(2)*x"), (r"y=\frac{1}2", "1/2"),
    (r"y=\frac1{2}x", "x/2"), (r"y=\frac\pi2", "pi/2"), (r"y=\frac x2", "x/2"),
])
def test_one_character_tex_arguments_as_mathlive_writes_them(latex, expected):
    from mathcore import graphtex

    assert str(graphtex.read_line(latex).sides[1]) == expected


def test_a_point_with_a_bare_fraction():
    s = shapes(r"A=\left(2,\frac23\right)", r"(-12,\frac23)")
    assert s[0]["y"][0] == pytest.approx(2 / 3) and s[1]["y"][0] == pytest.approx(2 / 3)


def test_names_as_mathlive_saves_them_once_edited():
    s = shapes(A, B, r"\operatorname{\mathrm{segment}}\left(A,B\right)", r"y=\operatorname{\mathrm{floor}}\left(x\right)")
    assert s[2]["shape"] == "segment" and s[3]["kind"] == "function"


O3 = [r"A=\left(0,0\right)", r"B=\left(4,0\right)", r"C=\left(0,3\right)"]


def test_intersections_exact_and_by_number():
    s = shapes(*O3, r"intersection(line(A,C),circle(B,5))", r"P=intersection(circle(A,3),circle(B,3),1)", r"intersection(segment(A,B),segment(C,(1,5)))")
    assert s[3]["facts"] == [r"\left(0,-3\right)", r"\left(0,3\right)"]
    assert s[4]["name"] == "P" and s[4]["y"][0] == pytest.approx(-5 ** 0.5)
    assert s[5]["error"] == "they don't cross"


def test_transformations():
    s = shapes(*O3, r"rotate(B,90,A)", r"reflect(polygon(A,B,C),line((0,5),(1,5)))", r"dilate(circle(B,1),3,A)", r"translate(B,vector(A,C))")
    assert (s[3]["x"], s[3]["y"]) == ([0.0], [4.0])
    assert s[4]["facts"][0] == r"\text{area }6" and max(s[4]["y"]) == 10.0
    assert s[5]["facts"][0] == r"\left(x-12\right)^{2}+y^{2}=9"
    assert (s[6]["x"], s[6]["y"]) == ([4.0], [3.0])


def test_circles_arcs_bisectors_polygons_tangents_measures():
    s = shapes(*O3, r"circle(A,B,C)", r"arc(A,B,C)", r"semicircle(A,B)", r"bisector(A,B)", r"bisector(B,A,C)", r"polygon(A,B,6)",
               r"tangent((10,0),circle(A,5))", r"area(polygon(A,B,C))", r"slope(line(B,C))", r"circle(A,B,(8,0))")
    assert s[3]["facts"][1] == r"r=\frac{5}{2}\approx2.5"
    assert s[4]["facts"][0] == r"90^{\circ}" and s[5]["facts"][0] == r"180^{\circ}"
    assert s[6]["facts"] == ["x=2"] and s[7]["facts"] == ["y=x"]
    assert s[8]["facts"][0] == r"\text{area }24\sqrt{3}\approx41.57"
    assert len(s[9]["facts"]) == 2
    assert s[10]["facts"] == ["=6"] and s[11]["facts"] == [r"=-\frac{3}{4}\approx-0.75"]
    assert "in a line" in s[12]["error"]


def test_lists_statistics_and_distributions():
    L = r"L=\left\lbrack3,7,7,2,9,4,7,5\right\rbrack"
    s = shapes(L, r"mean(L)", r"median(L)", r"stdev(L)", r"quantile(L,0.25)", r"\max\left(L\right)", r"normalcdf(-1,1)", r"binompdf(10,0.5,3)", r"binomcdf(10,\frac{1}{2},3)", r"length(L)")
    assert s[0]["facts"][0] == "n=8"
    assert [s[k]["facts"][0] for k in (1, 2, 4, 5, 9)] == [r"=\frac{11}{2}\approx5.5", "=6", r"=\frac{15}{4}\approx3.75", "=9", "=8"]
    assert s[3]["facts"][0] == r"=\frac{2\sqrt{70}}{7}\approx2.39"
    assert s[6]["facts"][0] == "=0.6827" and s[7]["facts"][0] == r"=\frac{15}{128}\approx0.1172" and s[8]["facts"][0] == r"=\frac{11}{64}\approx0.1719"


def test_pictures_of_data():
    L = r"L=\left\lbrack3,7,7,2,9,4,7,5\right\rbrack"
    s = shapes(L, r"histogram(L,2)", r"boxplot(L)", r"dotplot(L)", r"scatter([1,2,3],[2,4,5])", r"y=normalpdf(x,0,1)")
    assert s[1]["kind"] == "polygon" and s[1]["facts"][2] == r"\text{tallest }3"
    assert "2, 3.75, 6, 7, 9" in s[2]["facts"][0]
    assert s[3]["y"].count(3) == 1 and s[4]["x"] == [1.0, 2.0, 3.0]
    assert s[5]["kind"] == "function"


def test_triangulate_from_two_bearings():
    s = shapes(r"A=\left(0,0\right)", r"B=\left(10,0\right)", r"P=triangulate(A,45,B,315)", r"triangulate(A,45,B,45)")
    assert (s[2]["x"], s[2]["y"]) == ([5.0], [5.0])
    assert "never meet" in s[3]["error"]


def test_table_of_values():
    from mathcore.graph2d import op_values

    rows = op_values({"exprs": [r"f(x)=\frac{1}{x}"], "index": 0, "xs": ["-2", "0", "3"]})["rows"]
    assert [r["text"] for r in rows] == ["-1/2", "undefined", "1/3"]
    assert [r["text"] for r in op_values({"exprs": [r"y=mx+1"], "index": 0, "xs": ["2"], "vars": {"m": "3"}})["rows"]] == ["7"]


def test_a_function_analyzed_exactly():
    import sympy

    from mathcore.analysis import analyze
    from mathcore.graphtex import X

    rows = {r["label"]: r["tex"] for r in analyze(X**3 - 3 * X, ((-10, 10), (-10, 10)))}
    assert rows["Zeros"] == r"x=-\sqrt{3}\approx-1.732, x=0, x=\sqrt{3}\approx1.732"
    assert rows["Highs (local max)"] == r"\left(-1,2\right)" and rows["Lows (local min)"] == r"\left(1,-2\right)"
    assert rows["Increasing"] == r"\left(-\infty,-1\right)\cup\left(1,\infty\right)" and rows["Decreasing"] == r"\left(-1,1\right)"
    rational = {r["label"]: r["tex"] for r in analyze((X**2 - 1) / (X - 2), ((-10, 10), (-10, 10)))}
    assert rational["Asymptotes"] == "x=2,\\ y=x+2"
    log = {r["label"]: r["tex"] for r in analyze(sympy.log(X), ((-10, 10), (-10, 10)))}
    assert log["Domain"] == r"\left(0,\infty\right)" and log["Decreasing"].startswith(r"\text{nowhere}")
    assert {r["label"]: r["tex"] for r in analyze(X**3, ((-10, 10), (-10, 10)))}["Increasing"] == r"\left(-\infty,\infty\right)"


def test_riemann_sums_and_the_area_between():
    out = graph(r"y=x^{2}", r"y=x+2", latex=True, window={"xmin": -10, "xmax": 10, "ymin": -10, "ymax": 10},
                extras=[{"area": [0, 2], "riemann": {"kind": "left", "n": 4}, "between": 1}, None])["series"]
    facts = {s.get("role") or s["kind"]: s.get("facts") for s in out}
    assert facts["riemann"] == [r"L_{4}\approx1.75"]
    assert facts["between"] == [r"\text{area between }\frac{10}{3}\approx3.333"]


def test_rise_over_run_steps_along_the_line_on_whole_numbers():
    out = graph(r"y=\frac{2}{3}x+1", extras=[{"slope": True}])["series"]
    tri = next(s for s in out if s.get("role") == "slope")
    assert tri["x"] == [0.0, 3.0, 3.0] and tri["y"] == [1.0, 1.0, 3.0]
    assert [l["text"] for l in tri["labels"]] == ["run 3", "rise 2"]
    assert tri["facts"] == [r"m=\frac{\text{rise}}{\text{run}}=\frac{2}{3}"]


def test_rise_over_run_going_down_and_on_a_curve():
    out = graph(r"y=-2x+3", r"y=x^{2}", extras=[{"slope": True}, {"slope": True}])["series"]
    down = next(s for s in out if s.get("role") == "slope" and s["index"] == 0)
    assert down["labels"][1]["text"] == "rise −2" and down["labels"][0]["at"] == "above"
    assert down["facts"][0].endswith("=-2")
    curve = next(s for s in out if s.get("role") == "slope" and s["index"] == 1)
    assert curve["kind"] == "error" and "straight line" in curve["error"]


@pytest.mark.parametrize("line,n,mean", [
    (r"\left[1...5\right]", "n=5", r"\text{mean }3"), (r"\left[1,\ldots,5\right]", "n=5", r"\text{mean }3"),
    (r"\left[1,3...11\right]", "n=6", r"\text{mean }6"), (r"\left[5...1\right]", "n=5", r"\text{mean }3"),
    (r"\left[0,0.5...2\right]", "n=5", r"\text{mean }1"),
])
def test_a_list_can_count(line, n, mean):
    assert graph(line)["series"][0]["facts"] == [n, mean]


def test_a_list_in_a_point_is_a_point_for_each_number():
    s = graph(r"L=\left[1...4\right]", r"\left(L,L^{2}\right)")["series"][1]
    assert s["kind"] == "points" and s["x"] == [1, 2, 3, 4] and s["y"] == [1, 4, 9, 16]


def test_a_list_in_a_function_is_a_curve_for_each_number():
    s = graph(r"L=\left[1,2,3\right]", r"y=Lx")["series"][1]
    assert s["kind"] == "function" and s["y"].count(None) >= 3  # three lines, gaps between
    assert "intercepts" not in str(graph(r"y=\left[1,2\right]x")["markers"])


def test_a_list_counted_to_a_letter_waits_for_its_slider():
    waiting = graph(r"L=\left[1...n\right]", r"\left(L,L^{2}\right)")["series"]
    assert [s.get("missing") for s in waiting] == [["n"], ["n"]]
    s = graph(r"L=\left[1...n\right]", r"\left(L,L^{2}\right)", vars={"n": 3})["series"][1]
    assert s["x"] == [1, 2, 3] and s["y"] == [1, 4, 9]
