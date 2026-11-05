"""Guard against country and VIE false positives in source extraction."""
import unittest

from classify_tickers import functional_facility_evidence, incorporation_from_cover, operating_evidence, security_evidence, vie_evidence


class ResearchExtractionTests(unittest.TestCase):
    def test_explicit_operating_concentration(self):
        country, _ = operating_evidence('We conduct substantially all of our operations in China.')
        self.assertEqual(country, 'China')

    def test_new_mexico_is_not_a_foreign_operating_country(self):
        country, _ = operating_evidence('We conduct substantially all of our operations in the United States, including New Mexico.')
        self.assertEqual(country, 'United States')

    def test_properties_table_separators_are_supported(self):
        text = ('Item 2. | Properties Our research and manufacturing facilities are located in Texas, United States. '
                'We lease the entire building for our laboratories and distribution activities. Item 3. | Legal Proceedings')
        self.assertEqual(functional_facility_evidence(text, 'United States')[0], 'United States')

    def test_two_countries_do_not_become_one(self):
        country, _ = operating_evidence('Substantially all of our revenues are generated from customers in the United Kingdom and the United States.')
        self.assertEqual(country, '')

    def test_offshore_assets_do_not_become_us_operations(self):
        country, _ = operating_evidence('In the event that the majority of our assets are located outside the United States, any judgment obtained in the United States may not be enforceable.')
        self.assertEqual(country, '')

    def test_ip_contracts_are_not_vie_structures(self):
        for text in ('We rely on contractual arrangements to protect intellectual property.',
                     'We rely on the SEC to timely review our submissions.'):
            self.assertEqual(vie_evidence(text)[0], 'unknown')

    def test_historical_vie_is_not_assumed_current(self):
        text = 'We had previously relied on our variable interest entity in Malaysia.'
        self.assertEqual(vie_evidence(text)[0], 'unknown')

    def test_consolidated_vie_is_identified(self):
        self.assertEqual(vie_evidence('Assets of our consolidated VIEs were $70 million.')[0], 'yes_explicit')

    def test_no_unconsolidated_vie_does_not_mean_no_vie(self):
        self.assertEqual(vie_evidence('We do not have any unconsolidated variable interest entities.')[0], 'unknown')

    def test_security_distinguishes_depositary_from_direct_shares(self):
        prefix = 'Securities registered pursuant to Section 12(b) of the Act: '
        self.assertEqual(security_evidence(prefix + 'American depositary shares')[0], 'ADS')
        self.assertEqual(security_evidence(prefix + 'Class A ordinary shares')[0], 'direct_equity')

    def test_incorporation_uses_cover_not_office(self):
        text = 'Cayman Islands (Jurisdiction of incorporation or organization) Principal executive offices: Shanghai, China'
        self.assertEqual(incorporation_from_cover(text)[0], 'Cayman Islands')


if __name__ == '__main__':
    unittest.main()
