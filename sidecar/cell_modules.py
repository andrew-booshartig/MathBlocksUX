"""What a notebook's Python cells can import in a built app: the frozen
Python has only the modules something imports, so these are imported here
(never at run time — PyInstaller reads this file to pack them). The
sidecar's own packages (numpy, sympy, pandas, matplotlib) come with the
kernel anyway."""

# ruff: noqa: F401
import array
import base64
import bisect
import calendar
import cmath
import collections
import copy
import csv
import dataclasses
import datetime
import decimal
import enum
import fractions
import functools
import glob
import gzip
import hashlib
import heapq
import html
import itertools
import json
import operator
import pathlib
import pprint
import random
import re
import secrets
import shutil
import sqlite3
import statistics
import string
import textwrap
import time
import timeit
import typing
import urllib.parse
import uuid
import zipfile
