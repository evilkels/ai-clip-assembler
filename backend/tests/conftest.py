def pytest_addoption(parser):
    parser.addoption(
        "--update-export-fixtures",
        action="store_true",
        default=False,
        help="Rewrite generated export fixture files",
    )
