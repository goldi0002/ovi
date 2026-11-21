using Ovi.Api.Security;

namespace Ovi.Api.Tests;

/// <summary>Unit tests for how a match Google reports is placed on the URLs we sent.</summary>
[TestClass]
public sealed class SafeBrowsingAttributeTests
{
    private static string[] Run(string[] sent, params string[] reported) =>
        SafeBrowsingUrlThreatCheck.Attribute(sent, reported).OrderBy(x => x, StringComparer.Ordinal).ToArray();

    [TestMethod]
    public void Single_url_is_flagged_by_any_match()
    {
        CollectionAssert.AreEqual(new[] { "https://a.com/x" }, Run(["https://a.com/x"], "http://totally.other/"));
    }

    [TestMethod]
    public void Exact_match_flags_only_that_url()
    {
        CollectionAssert.AreEqual(new[] { "https://a.com/x?id=1" },
            Run(["https://a.com/x?id=2", "https://a.com/x?id=1"], "https://a.com/x?id=1"));
    }

    [TestMethod]
    public void Exact_match_on_one_path_leaves_a_sibling_path_clean()
    {
        CollectionAssert.AreEqual(new[] { "https://a.com/x" }, Run(["https://a.com/y", "https://a.com/x"], "https://a.com/x"));
    }

    [TestMethod]
    public void Different_scheme_case_fragment_and_trailing_slash_still_match()
    {
        CollectionAssert.AreEqual(new[] { "https://EVIL.example.net/x/#f" },
            Run(["https://ok.example.com/", "https://EVIL.example.net/x/#f"], "http://evil.example.net/x"));
    }

    [TestMethod]
    public void A_reported_host_covers_every_url_below_it_and_nothing_else()
    {
        CollectionAssert.AreEqual(new[] { "https://evil.com/a", "https://evil.com/b/c" },
            Run(["https://evil.com/a", "https://evil.com/b/c", "https://evil.community/a", "https://good.com/"], "http://evil.com/"));
    }

    [TestMethod]
    public void A_path_prefix_is_matched_on_segment_boundaries()
    {
        CollectionAssert.AreEqual(new[] { "https://a.com/x/1" },
            Run(["https://a.com/x/1", "https://a.com/xylophone", "https://a.com/y"], "http://a.com/x/"));
    }

    [TestMethod]
    public void An_unplaceable_match_on_a_known_host_flags_that_hosts_urls()
    {
        CollectionAssert.AreEqual(new[] { "https://a.com/1", "https://a.com/2" },
            Run(["https://a.com/1", "https://a.com/2", "https://b.com/"], "http://a.com/not-sent/"));
    }

    [TestMethod]
    public void An_unplaceable_match_on_no_known_host_fails_closed_flagging_everything()
    {
        CollectionAssert.AreEqual(new[] { "https://a.com/1", "https://b.com/2" },
            Run(["https://a.com/1", "https://b.com/2"], "http://unrelated.example.org/z"));
    }

    [TestMethod]
    public void No_matches_flag_nothing()
    {
        Assert.AreEqual(0, Run(["https://a.com/1", "https://b.com/2"]).Length);
    }
}
