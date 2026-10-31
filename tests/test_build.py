import json
import os
import unittest

from museum import build

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(HERE, "fixtures", "sample.config.json")


def exhibit(key, date, **kw):
    return dict({"type": "exhibit", "key": key, "date": date, "source": "s"}, **kw)


class MergeTest(unittest.TestCase):
    def test_two_sources_describing_one_thing_keep_everything_either_knows(self):
        doc = build.build(SAMPLE)
        b = next(e for e in doc["exhibits"] if e["id"] == "b")
        self.assertEqual(b["title"], "Second Thing")
        self.assertEqual(b["date"], "2021-01-01T00:00:00Z")  # the earlier date wins
        self.assertEqual(b["measures"], {"commits": 400, "stars": 3, "localCommits": 7})
        self.assertEqual([l["label"] for l in b["links"]], ["Mirror"])
        self.assertEqual(b["badges"], ["mirrored"])
        self.assertEqual(b["sources"], ["primary", "secondary"])



class PrivacyTest(unittest.TestCase):
    def test_a_withheld_key_is_gone_with_its_activity_whatever_other_sources_say(self):
        exhibits, activity, _ = build.gather([
            exhibit("secret", "2021-01-01", title="Secret", source="local"),
            {"type": "activity", "date": "2021-01-01", "count": 5, "source": "local", "key": "secret"},
            {"type": "activity", "date": "2021-01-01", "count": 2, "source": "local", "key": "open"},
            {"type": "withhold", "key": "secret", "source": "github"},
        ])
        self.assertNotIn("secret", exhibits)
        self.assertEqual(activity["local"]["2021-01-01"], 2)

    def test_enrich_only_records_need_another_source_to_show_the_exhibit(self):
        exhibits, _, _ = build.gather([
            exhibit("shown", "2021-01-01", source="github"),
            exhibit("shown", "2020-01-01", source="git", enrichOnly=True, measures={"localCommits": 3}),
            exhibit("local-only", "2021-01-01", source="git", enrichOnly=True),
        ])
        self.assertEqual(set(exhibits), {"shown"})
        self.assertEqual(exhibits["shown"]["measures"], {"localCommits": 3})
        self.assertEqual(exhibits["shown"]["date"], "2020-01-01")
        self.assertNotIn("_enrichOnly", exhibits["shown"])


class ErasTest(unittest.TestCase):
    def test_every_year_from_first_to_last_is_an_era_even_when_empty(self):
        doc = build.build(SAMPLE)
        self.assertEqual([e["id"] for e in doc["eras"]], ["2019", "2020", "2021"])
        self.assertEqual(doc["eras"][1]["halls"][0]["exhibits"], ["only-here"])

    def test_period_stats_join_their_era(self):
        doc = build.build(SAMPLE)
        era = next(e for e in doc["eras"] if e["id"] == "2021")
        self.assertIn({"label": "Contributions", "value": 17}, era["stats"])

    def test_a_crowded_year_splits_into_whole_months_each_under_the_limit(self):
        items = [{"id": f"x{i}", "date": f"2026-{m:02d}-01"} for i, m in enumerate([1] * 3 + [8] * 5 + [9] * 2 + [10] * 4)]
        halls = build.month_halls(2026, items, 6)
        self.assertEqual([h["id"] for h in halls], ["2026-01", "2026-08", "2026-09"])
        self.assertTrue(all(len(h["exhibits"]) <= 6 for h in halls))
        self.assertEqual(sum(len(h["exhibits"]) for h in halls), len(items))
        self.assertEqual(halls[-1]["end"], "2026-12-31")

    def test_a_single_month_too_big_for_the_limit_is_still_one_hall(self):
        items = [{"id": f"x{i}", "date": "2026-08-01"} for i in range(10)]
        self.assertEqual([len(h["exhibits"]) for h in build.month_halls(2026, items, 4)], [10])


class RangeTest(unittest.TestCase):
    def test_exhibits_dated_outside_the_eras_join_the_nearest_one_instead_of_vanishing(self):
        items = [{"id": "old", "date": "2005-04-16"}, {"id": "in", "date": "2017-02-01"}, {"id": "new", "date": "2031-01-01"}]
        eras = build.eras_by_year(items, {}, {}, {"from_year": 2016, "to_year": 2018})
        placed = {i: e["id"] for e in eras for h in e["halls"] for i in h["exhibits"]}
        self.assertEqual(placed, {"old": "2016", "in": "2017", "new": "2018"})

    def test_a_split_year_keeps_folded_in_exhibits(self):
        items = [{"id": "old", "date": "2001-06-01"}] + [{"id": f"x{i}", "date": "2016-08-01"} for i in range(3)]
        eras = build.eras_by_year(items, {}, {}, {"from_year": 2016, "to_year": 2016, "split_over": 2})
        self.assertEqual(sum(len(h["exhibits"]) for h in eras[0]["halls"]), 4)
        self.assertEqual(eras[0]["halls"][0]["exhibits"], ["old"])


class ScaleTest(unittest.TestCase):
    def test_size_is_log_scaled_to_the_largest_and_missing_is_zero(self):
        items = [{"measures": {"c": 0}}, {"measures": {"c": 9}}, {"measures": {"c": 99}}, {"measures": {}}]
        build.scale(items, "c")
        self.assertEqual([e["size"] for e in items], [0.0, 0.5, 1.0, 0.0])

    def test_activity_is_kept_per_source(self):
        doc = build.build(SAMPLE)
        self.assertEqual(doc["activity"]["primary"], "primary")
        self.assertEqual(doc["activity"]["series"]["primary"]["2021-07-09"], 12)

    def test_legend_lists_each_value_once_most_common_first(self):
        doc = build.build(SAMPLE)
        self.assertEqual([v["id"] for v in doc["legend"]["kind"]["values"]], ["Java", "Python", "Other"])


if __name__ == "__main__":
    unittest.main()
