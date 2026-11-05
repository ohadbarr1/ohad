// fox · חיסכון ארוך טווח: רבעוני · Long-term savings, quarterly (reports and regulator join)
// https://fox-research-il.web.app/data/tables/v1/savings_q.csv (also .json) · schema v1: a column never changes meaning; new columns are only appended
// columns: entity_id, entity_name, dim_id, dim_label, metric_id, metric_label, period, period_label, period_end, value, unit, kind, standard, source_id, source_page, source_url, source_name, as_of, note, version
// Excel (Windows / Mac, Microsoft 365): Data > Get Data > From Other Sources > Blank Query > Advanced Editor > paste > Done >
//   Close & Load. Then Data > Refresh All refreshes it. First refresh: Web content, Anonymous, Connect; privacy level Public.
// Excel (Windows / Mac, Microsoft 365): נתונים > קבלת נתונים > ממקורות אחרים > שאילתה ריקה > עורך מתקדם > הדבקה > סיום >
//   סגור וטען. רענון: נתונים > רענן הכל. ברענון הראשון: תוכן אינטרנט, אנונימי, התחבר.
let
    Source = Csv.Document(Web.Contents("https://fox-research-il.web.app/data/tables/v1/savings_q.csv"), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Blanks = Table.ReplaceValue(Headers, "", null, Replacer.ReplaceValue, {"period_end", "value", "source_page", "as_of"}),
    Typed = Table.TransformColumnTypes(Blanks, {{"period_end", type date}, {"value", type number}, {"source_page", Int64.Type}, {"as_of", type date}}, "en-US")
in
    Typed
