module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint", "import"],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript"
    ],
    rules: {
        "no-console": "error",
        "import/order": [
            "error",
            {
                "groups": [["builtin", "external"], "internal", ["parent", "sibling", "index"]],
                "newlines-between": "always",
                "alphabetize": { "order": "asc", "caseInsensitive": true }
            }
        ],
        "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
};