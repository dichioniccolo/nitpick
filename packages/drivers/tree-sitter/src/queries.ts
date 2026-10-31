import type { Language } from "@nitpick/code-graph-domain";

// Capture names read `<kind>.name`, with the whole definition captured as
// `<kind>.def` so its line span is known. `call.name` and `import.name` are
// references. Queries stay small: the review agent reads the source itself,
// so the graph only has to answer "where is it" and "who uses it".
const typescript = `
(function_declaration name: (identifier) @function.name) @function.def
(generator_function_declaration name: (identifier) @function.name) @function.def
(method_definition name: (property_identifier) @method.name) @method.def
(class_declaration name: (type_identifier) @class.name) @class.def
(abstract_class_declaration name: (type_identifier) @class.name) @class.def
(interface_declaration name: (type_identifier) @interface.name) @interface.def
(type_alias_declaration name: (type_identifier) @type.name) @type.def
(enum_declaration name: (identifier) @enum.name) @enum.def
(lexical_declaration (variable_declarator name: (identifier) @function.name value: [(arrow_function) (function_expression)])) @function.def
(call_expression function: (identifier) @call.name)
(call_expression function: (member_expression property: (property_identifier) @call.name))
(new_expression constructor: (identifier) @call.name)
(import_statement source: (string (string_fragment) @import.name))
`;

const javascript = `
(function_declaration name: (identifier) @function.name) @function.def
(generator_function_declaration name: (identifier) @function.name) @function.def
(method_definition name: (property_identifier) @method.name) @method.def
(class_declaration name: (identifier) @class.name) @class.def
(lexical_declaration (variable_declarator name: (identifier) @function.name value: [(arrow_function) (function_expression)])) @function.def
(call_expression function: (identifier) @call.name)
(call_expression function: (member_expression property: (property_identifier) @call.name))
(new_expression constructor: (identifier) @call.name)
(import_statement source: (string (string_fragment) @import.name))
`;

const python = `
(function_definition name: (identifier) @function.name) @function.def
(class_definition name: (identifier) @class.name) @class.def
(call function: (identifier) @call.name)
(call function: (attribute attribute: (identifier) @call.name))
(import_from_statement module_name: (dotted_name) @import.name)
(import_statement name: (dotted_name) @import.name)
`;

const go = `
(function_declaration name: (identifier) @function.name) @function.def
(method_declaration name: (field_identifier) @method.name) @method.def
(type_declaration (type_spec name: (type_identifier) @type.name)) @type.def
(call_expression function: (identifier) @call.name)
(call_expression function: (selector_expression field: (field_identifier) @call.name))
(import_spec path: (interpreted_string_literal) @import.name)
`;

const rust = `
(function_item name: (identifier) @function.name) @function.def
(struct_item name: (type_identifier) @class.name) @class.def
(enum_item name: (type_identifier) @enum.name) @enum.def
(trait_item name: (type_identifier) @interface.name) @interface.def
(type_item name: (type_identifier) @type.name) @type.def
(mod_item name: (identifier) @module.name) @module.def
(call_expression function: (identifier) @call.name)
(call_expression function: (field_expression field: (field_identifier) @call.name))
(call_expression function: (scoped_identifier name: (identifier) @call.name))
(use_declaration argument: (_) @import.name)
`;

const java = `
(class_declaration name: (identifier) @class.name) @class.def
(interface_declaration name: (identifier) @interface.name) @interface.def
(enum_declaration name: (identifier) @enum.name) @enum.def
(method_declaration name: (identifier) @method.name) @method.def
(constructor_declaration name: (identifier) @method.name) @method.def
(method_invocation name: (identifier) @call.name)
(object_creation_expression type: (type_identifier) @call.name)
(import_declaration (scoped_identifier) @import.name)
`;

export const queries: Readonly<Record<Language, string>> = {
  typescript,
  tsx: typescript,
  javascript,
  python,
  go,
  rust,
  java,
};

export const grammarFiles: Readonly<Record<Language, string>> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
};
