// fox · חדש מאז ההורדה הקודמת · What changed since the previous build
// https://fox-research-il.web.app/data/tables/v1/changes.csv (also .json) · schema v1: a column never changes meaning; new columns are only appended
// columns: build_date, table, change, entity_id, entity_name, dim_id, dim_label, metric_id, metric_label, period, period_label, old_value, new_value, unit
// Excel (Windows / Mac, Microsoft 365): Data > Get Data > From Other Sources > Blank Query > Advanced Editor > paste > Done >
//   Close & Load. Then Data > Refresh All refreshes it. First refresh: Web content, Anonymous, Connect; privacy level Public.
// Excel (Windows / Mac, Microsoft 365): נתונים > קבלת נתונים > ממקורות אחרים > שאילתה ריקה > עורך מתקדם > הדבקה > סיום >
//   סגור וטען. רענון: נתונים > רענן הכל. ברענון הראשון: תוכן אינטרנט, אנונימי, התחבר.
let
    Source = Csv.Document(Web.Contents("https://fox-research-il.web.app/data/tables/v1/changes.csv"), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Blanks = Table.ReplaceValue(Headers, "", null, Replacer.ReplaceValue, {"old_value", "new_value", "build_date"}),
    Typed = Table.TransformColumnTypes(Blanks, {{"old_value", type number}, {"new_value", type number}, {"build_date", type date}}, "en-US")
in
    Typed
