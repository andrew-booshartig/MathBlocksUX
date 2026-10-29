

def test_graph_reads_latex_lines():
    from mathcore.graphing import op_graph

    r = op_graph({"latex": True, "exprs": [r"2x+3y=6", r"y=mx+b", r"\left(2,5\right)", r"y=\frac{1}{2}x-3", r"y=\frac{"], "vars": {"m": "2"}})
    kinds = [s["kind"] for s in r["series"]]
    assert kinds == ["function", "error", "points", "function", "error"]
    assert r["series"][1]["missing"] == ["b"]  # a letter with no value: it gets a slider
    assert r["series"][1]["letters"] == ["b", "m"]  # m has a value, but it is still used
    assert {"x": 3.0, "y": 0.0} in [{"x": m["x"], "y": m["y"]} for m in r["markers"] if m["kind"] == "x-intercept"]
