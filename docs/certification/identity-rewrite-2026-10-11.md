# Identity rewrite of main, 2026-10-11

On 2026-10-11 at 11:00 PM PT main's history was rewritten on the owner's
order. Two commits ended with the trailer
`Co-Authored-By: Muse Code <noreply@users.noreply.github.com>`, a line a lane
invented. On GitHub that address belongs to a stranger's account, which then
appeared under the repository's Contributors.

## What changed

- The two messages (old `2614ed56f` and `a1103c3f0`) now end
  `Co-Authored-By: Muse Spark (contributor) via Muse Code`.
- 65 commits on main have new ids: those two, and 63 descendants whose only
  change is their parent lines.
- Every tree is byte-identical, commit for commit, so every gate result
  recorded against an old id stands. Authors, committers and both dates are
  unchanged.
- main moved from `be6eaefbe` to `f8435aaac`, and tag `v0.18.0` moved with it.
  `v0.17.2` (`59309b490`) and everything before it are unchanged.
- The old main is kept locally at
  `refs/archive/2026-10-11/main-before-identity-rewrite`.
- Records and commit messages written before the rewrite cite the old ids;
  the tables below translate them.

## How it was checked

On the release branch (INT0180), old and new history were paired by
structure, head with head and parent with parent: 65 pairs for main, 71 for
the release train and 73 for `release/0.18.1`. Every pair has the same tree,
author, committer and dates. Exactly two pairs differ in their message, each
by the one trailer line. In the history of the rewritten release head the
address `noreply@users.noreply.github.com` no longer occurs; the
`users.noreply.github.com` addresses that remain are the owner's id-form
address and dependabot's.

## Old to new: main (65)

Oldest first; the last row is the 0.18.0 release merge.

| Old                                        | New                                        |
| ------------------------------------------ | ------------------------------------------ |
| `2614ed56fda9f8c944dc3e367765fe8812db9d05` | `a4b815c66e3bd6105947e2479c719365d91082d9` |
| `a1103c3f0bf37c9a8169b691b44d8f99efce0413` | `c39956bf6095bc397e869ae628f25f32a377e315` |
| `359aed60781caf8de8215e51de905c6d7de2045b` | `0f298b5f6bcb6f02dc41f487ded4dbd914b4df19` |
| `47b5267bd313e88fe9c34750bb39fa1103e4dafa` | `ca43c66aeebf2631c570e7f69e31385cca18908b` |
| `db98e7b597e10d5ba52aedd28aec54dd0d965513` | `a871dd5430f315bed199f1a8c4dced86724a9774` |
| `c212d38cfafb9b0a60ee562caf073ff25e94f4de` | `298906b20536dfcbaa14e9ba5e82e89c82a9b8bb` |
| `9a4ba51df9eecf98ee067b2c62d54d2c7274263c` | `cccebd0066738feb27dc664ce282cafe728defa1` |
| `2c3bd07c2f5a6bf56a57824e928024c152187b48` | `9c2833c930a7e18d0091ac35e64a0822a32de63a` |
| `5fed6f040f886a2cfac932a3c391cba7db012166` | `54246c7f4b27178ec0bdd99fc2a6fdc138bdfb4f` |
| `79071a8adfe40260d318e780e12fe340e665ada5` | `48eece93ddeeb3a43a2e6e855ac0b3f04f0a1f46` |
| `9c8ed7f7084b99c547c826ad637ff8c6e51a74b1` | `d564c69fba6f851e7828eaba37c67708ea1757d7` |
| `3c76add1f674948ece6f7b8ff6a48473e21b8dd9` | `668361cf3b9b09e194da2175b5fabb8bc1cdef32` |
| `175a9f43ba92c4927f5a2b4699c92c3a9f34b5e3` | `85a6b8df6142305ce874f85e90b2b65485896afa` |
| `261309b8011f4157feb343fe22483d0ae2bef4ff` | `e0198d5295f6277f32503cde6c578ad846756d3e` |
| `f0097f027fcc02e794a9f6da4802e1d71a773611` | `689c8388d0f3c383561d53af14bf0758246ec375` |
| `671f0da9545860354e22fb05fa33aa55e17353a1` | `a17682073443bf10e94dce762e7184030cfbc243` |
| `c3a827b24c0e6fd898dea69b00bf87f4653f049d` | `36fc981dda3d6105729f1857bd85e1fea4d2ef02` |
| `0e76323f63a67725cb73dea7d24e11abdd39565b` | `177ee4db693b1a25ba816df298aac6ecf04267b4` |
| `5c9e8f68caaf70178989db76eabdb198f0a52393` | `f74b92616d02540969a1301b29701179e649433e` |
| `7a325687e88065daaf510cd1feafe806192d5122` | `3abe706744026f92f0048760550368661b242890` |
| `8ab4f26f8d8acff4a0ab1f817d4dac9825d90fc5` | `4a471395e9338bfef091aeb24cc4b861608e7238` |
| `bdb8fd4f189ce8473fdaa742cb83f32303ac6c63` | `f228bb6bfa7a63ce551d9f9f082cb2153cf3a47f` |
| `b3ae70c196be40348fc80a2d188300a54f776473` | `c217a52470fb0dfbad0d0f849442886070bdc194` |
| `245b3df43c076b1ad63e437669654d3e911055a5` | `237516ddeb46454d5fff86bd6f719593c07f36e3` |
| `803f42f955689b0cacca06bbd15bbdb7ca00d396` | `b9da9e69ce240a0257be64df408e2c9a44ec8cde` |
| `45412ff0f0c6aa6197140082db426b68756d2b6a` | `254453b4b3964716b9c9ea798238dffd40c1505f` |
| `1f0dc89ed7e3d11d392f3156599b938875a4458d` | `de365a28ddaadad9e2a014bb11e0a3577d6835ff` |
| `acf388a14d69ff242d4bf5d365779b2dfdc2610a` | `aee85cf2adcc79d61ce0857ba805f9152f1779fe` |
| `ee9a742df3f870ef87559e428d3ba7142ef07716` | `8848c2f3cadc72649093390431ca6526d91c65f9` |
| `98b2b00d5a6e8c9265626bef73146cf037e36d22` | `a4adb8b2e18786c3f3a2c1541a9b8a69ca187de2` |
| `b1e19ec7ee0347830bc5c6497b8868e440b84b11` | `f0245763dca7fcf24778b7c7cc8dd6e8dd0d2142` |
| `d36f5fa2d4aafe65101bba460fb2d2f14d6f5809` | `30f64f150b12a761d5e8411c5404c2f704027a8c` |
| `f7b13f45ef8be34451b5da779fa8ee49f2c8785b` | `e2465a6578c0a9f9eff470462da8dc981f6c92ab` |
| `bb25544b7d5bc57fdf9c2c7d656fe3d919b764b5` | `c46a02a2e20982cd929e98b6d56e569db8489eb0` |
| `a9aaa7e18b4575f862ed9aadee437c8b2449b871` | `ed5a4acdcc0e581c53fad013758fe5a6d701ee01` |
| `b457fbdbca18497249e948c8df22bebc3b2ac4d0` | `b5b4ca488000c5c35b4a51fd1a39058ffd6a2bc1` |
| `9d992da7211d35bfb2d8f9cc2ed9896ad5b6540a` | `34067b43358f726bef41211a1b954d918b47ae78` |
| `d4b06c62b76faa4f6036aa7f5340eaa8361ca169` | `12c29b1bc3090948adb798903802f10f8397e668` |
| `fcc925ff23005ea7612bb081b056f21f151befa3` | `710370141e7b16ff1b292b232559536619210709` |
| `43fd6904d28d2565e8d18e45d8b8d2abca351a9c` | `cd55e80a501149d8aacb0cf27b5d21b54f87a5c6` |
| `a83e71e8dc16020cde715683ab7a4d47018b3534` | `ed0446b0ead44be72e1cfbf7d87d7035cc0453f9` |
| `ddfa8fc9a8a3edbf5fa2761a49bbd1effcd5e344` | `642c0defa2cd5b07e57e88e76250009b1f898da0` |
| `af67368a22eeffed80ac4c7bc193a980fb8bad21` | `9e077252c7859f8811ad2a5da55dc61c08491c2a` |
| `9bd564035e2b9da2794d622d513a570ca517c921` | `adbe5ef696aa4ed234160de882519d2187779052` |
| `fd349cc8d64a846c56f5fb9887d80f343a1c39d5` | `87e382299bb6f10ecd8fac5a8c4053ab906a6e9e` |
| `caba5dab3f96cba9bf56cb8f98481218df28c56f` | `4dd4c2bc1037e0bda57553e42060f9ba2b21b706` |
| `45d50ac4133f734543d5857da436b61d4d664e59` | `6d5fa2409c346897ad6d88b3368b98397e51a4bf` |
| `d9454f15b7ea9b061c2dc10da0e3cb43d491e7dc` | `123de93962b30ce173e110f79e15667f88726c98` |
| `00be5fe6186566f9d94249713ee6f9b14a303b09` | `a90cb1ea90fb3580c6355b7335985099a498559a` |
| `4bcd7502f8212e98eccbe6c301adb99f94167bde` | `1fea97b895a3f2cd2b969957da20ff9b939b1ef9` |
| `26d144145876b9784d83f88f2e3ac874d1f9bfaa` | `473bd97341d47ef96bfb8b2da52679638e2b6d17` |
| `f95b9b9dc06b172e947497fe190ed7458ee2e116` | `a183ab4c7bb59db83b56e09d3687d5d6acb73c4e` |
| `5735128d575bd2afe689067a6c410a94938e8781` | `c8aa4bd4ea8a19f82156dc9330145259f22a1d48` |
| `2cba4e41194ca20a20e04e7d14f29bc248af0565` | `6888746ac1ace7a7c3edbc6d6331b0daa41b3bbf` |
| `06554b56c6dcce7b3ca643319f2a2a0a7dbc4b93` | `5d04e5de7c4c7a8f2363cabc5d7103a82d0bcdc2` |
| `2303c952d7cf187ef559b1018f21a3f0fdb1bde8` | `b0a33097e3f38559dbb85d9f8ea2aa8b07b70789` |
| `874b04372a40c0f8f2d79e7e490be410387e9905` | `10e0f0168a8c4e11d641be696108397091f93926` |
| `549c6f499d3e0e32b8a3c154310f086403ee61e9` | `1c36b780898d05bccdbd854860a883bcc6256c0f` |
| `f04ce5286b51d7b6440b832dacc617a10ee718ab` | `1cde37c6b72155d1a7f91f646ee05dc60e334f2c` |
| `eb7cd2efd9d3ad1cfa305463e81eb66cca79d71d` | `d6063b793d5583772e91406fede344d44343ebc9` |
| `592f013fb66dad1d15e2bf988f70dc0e3c533ee7` | `8a70195d1c11ffd25f7874855ae05d194b3476ad` |
| `85341b01f662730a810692e35fa7e071bd78da8e` | `77541ca8815e2365aedc58314ba5964bec639cf6` |
| `b6f2f160701a80496334ed23209010d4f21a839b` | `f5d628599e3ac5606d740d23560e2bfa1b51b412` |
| `c4397d6034cb4406a1502bb5468c2f5503570711` | `5c57cc3faa413f38a1173a349de1af28085e30c3` |
| `be6eaefbe13432ee4e2006e5e50c8aed268041fb` | `f8435aaacb7db5387ce205c9e84738bd95e661f3` |

## Old to new: release train and release/0.18.1 (8)

The merge of main into the train, the four commits of the panel mark lane,
its merge, the 0.18.1 release commit and the released records.

| Old                                        | New                                        |
| ------------------------------------------ | ------------------------------------------ |
| `330c1228f21aa2556f8f1f1e72053ea1a6d85112` | `0977712827f45062f69fed9200005198bf2f4509` |
| `1b16c9a618954b23d5ad0fdf1da53ee58d2eb939` | `0f4822a5b0e7144a38b0c312a5c972f89ed49ed1` |
| `aff00354c87b18707caa6d8700dd1d79eeb550f6` | `e2544e9ee64ddcf505b2a95270eefd254499423b` |
| `fd8a7447251450314c307915b0043857337c9b21` | `fbdf3ea19e56e18b997dc392a2bf5197b0b3b139` |
| `e06c05f977e14e0e10de2f95e134762e3386f8e5` | `df62248870a81db0101dc7e7f8cc9ecb426ca6a0` |
| `a2e0141215d1a5420fbd14591b77b4352f318db6` | `07f7aa69f445234384d2751ea40e0e98ced6efa3` |
| `dcb8d4669e3f7232c53f9d1d5f8579b3fd097aaf` | `6082d49e51a2661f5d607522853f6e7f999a0359` |
| `90870addbf5f61806fa49b40d86609fabebd110d` | `8abe016532af731b6234fd08b521f914ac3e6466` |
