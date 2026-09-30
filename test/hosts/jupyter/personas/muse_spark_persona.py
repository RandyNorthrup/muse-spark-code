# Muse Spark as a Jupyter AI persona through its ACP agent, as docs/acp.md
# gives it; the host check (hosts.yml) names the installed agent and the
# fake Muse Code CLI through MUSE_ACP and MUSE_ACP_ARGS.
import os
import shlex

from jupyter_ai_acp_client.base_acp_persona import BaseAcpPersona
from jupyter_ai_persona_manager import PersonaDefaults

AGENT = os.environ.get("MUSE_ACP", "muse-spark-code-acp")
EXTRA_ARGS = shlex.split(os.environ.get("MUSE_ACP_ARGS", ""))


class MuseSparkAcpPersona(BaseAcpPersona):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, executable=[AGENT, *EXTRA_ARGS], **kwargs)

    @property
    def defaults(self) -> PersonaDefaults:
        return PersonaDefaults(
            name="Muse Spark",
            description="Muse Spark Code (Unofficial) through its ACP agent.",
            avatar_path=os.path.join(os.path.dirname(__file__), "muse_spark.svg"),
            system_prompt="unused",
        )
