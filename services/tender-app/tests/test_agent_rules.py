import unittest

from app.agent import classify_by_rules


class AgentBusinessFitRulesTest(unittest.TestCase):
    def test_core_business_scores_as_priority_opportunity(self) -> None:
        result = classify_by_rules(
            title="某产业园全过程工程咨询服务招标公告",
            detail_content="招标范围包括项目管理、造价咨询、全过程咨询服务。",
        )

        self.assertEqual(result.score, 5)
        self.assertEqual(result.action, "重点跟进")
        self.assertTrue(result.needs_llm)

    def test_tender_agency_only_is_not_recommended(self) -> None:
        result = classify_by_rules(title="某医院招标代理服务采购公告")

        self.assertEqual(result.score, 1)
        self.assertEqual(result.action, "不推荐")
        self.assertFalse(result.needs_llm)

    def test_supervision_only_is_not_recommended(self) -> None:
        result = classify_by_rules(title="某道路工程施工监理招标公告")

        self.assertEqual(result.score, 1)
        self.assertEqual(result.action, "不推荐")
        self.assertFalse(result.needs_llm)

    def test_design_only_is_not_recommended(self) -> None:
        result = classify_by_rules(title="某学校方案设计及初步设计招标公告")

        self.assertEqual(result.score, 1)
        self.assertEqual(result.action, "不推荐")
        self.assertFalse(result.needs_llm)

    def test_epc_only_is_not_recommended(self) -> None:
        result = classify_by_rules(title="某园区EPC工程总承包招标公告")

        self.assertEqual(result.score, 1)
        self.assertEqual(result.action, "不推荐")
        self.assertFalse(result.needs_llm)

    def test_epc_with_project_management_is_sent_to_llm(self) -> None:
        result = classify_by_rules(
            title="某片区EPC工程总承包全过程项目管理咨询服务",
            detail_content="服务内容包括项目管理、造价咨询和全过程咨询。",
        )

        self.assertGreaterEqual(result.score, 4)
        self.assertTrue(result.needs_llm)


if __name__ == "__main__":
    unittest.main()
