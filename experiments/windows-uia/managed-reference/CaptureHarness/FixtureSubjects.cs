namespace DualSurface.UiaCapture;

internal sealed record FixtureSubject(string Correlation, string Type, string Role,
    string? Container, string Action, string[] RequiredPatterns, bool Sensitive = false);

// Frozen trusted semantic subject definitions, NOT expected golden nodes or
// observed state. Names come from copied provider data, except the sensitive
// host label. Structural Window admission is separate from the seven semantic
// families; no raw WindowPattern-presence parity is claimed by this foundation.
internal static class FixtureSubjects
{
    public static readonly IReadOnlyList<FixtureSubject> All = Array.AsReadOnly(new FixtureSubject[]
    {
        S("fixture-window", "Window", "window", null),
        S("invoke", "Button", "button", "fixture-window", "click", "Invoke"),
        S("value", "Edit", "textbox", "fixture-window", "set_value", "Value"),
        S("readonly", "Edit", "textbox", "fixture-window", "none", "Value"),
        S("toggle", "CheckBox", "checkbox", "fixture-window", "toggle", "Toggle"),
        S("disabled", "Button", "button", "fixture-window", "click", "Invoke"),
        S("disabled-toggle", "CheckBox", "checkbox", "fixture-window", "toggle", "Toggle"),
        new("sensitive", "Edit", "textbox", "fixture-window", "none", [], true),
        S("selection", "List", "listbox", "fixture-window", "none", "Selection"),
        S("selection-a", "ListItem", "option", "selection", "select", "SelectionItem"),
        S("selection-b", "ListItem", "option", "selection", "select", "SelectionItem"),
        S("combo", "ComboBox", "combobox", "fixture-window", "none", "Selection", "ExpandCollapse"),
        S("combo-a", "ListItem", "option", "combo", "select", "SelectionItem"),
        S("combo-b", "ListItem", "option", "combo", "select", "SelectionItem"),
        S("radio-a", "RadioButton", "radio", "fixture-window", "select", "SelectionItem"),
        S("radio-b", "RadioButton", "radio", "fixture-window", "select", "SelectionItem"),
        S("tabs", "Tab", "tablist", "fixture-window", "none", "Selection"),
        S("tab-a", "TabItem", "tab", "tabs", "select", "SelectionItem"),
        S("tab-b", "TabItem", "tab", "tabs", "select", "SelectionItem"),
        S("expand", "Group", "button", "fixture-window", "expand", "ExpandCollapse"),
        S("expanded-child", "Button", "button", "expand", "click", "Invoke"),
        S("range", "Slider", "slider", "fixture-window", "set_range", "RangeValue"),
        S("replace", "Button", "button", "fixture-window", "click", "Invoke"),
        S("dynamic-a", "Button", "button", "fixture-window", "click", "Invoke"),
        S("dynamic-b", "Button", "button", "fixture-window", "click", "Invoke"),
        S("modal", "Button", "button", "fixture-window", "click", "Invoke"),
        S("replace-window", "Button", "button", "fixture-window", "click", "Invoke"),
        S("unsupported", "Custom", "generic", "fixture-window"),
        S("injection", "Button", "button", "fixture-window", "click", "Invoke"),
        S("hidden", "Text", "text", "fixture-window"),
        S("offscreen", "Button", "button", "fixture-window", "click", "Invoke"),
        S("reset", "Button", "button", "fixture-window", "click", "Invoke"),
        S("status", "Text", "status", "fixture-window"),
        S("modal-window", "Window", "window", null),
        S("modal-confirm", "Button", "button", "modal-window", "click", "Invoke"),
        S("modal-cancel", "Button", "button", "modal-window", "click", "Invoke"),
    });
    private static FixtureSubject S(string id, string type, string role, string? container,
        string action = "none", params string[] patterns) => new(id, type, role, container, action, patterns);
}
