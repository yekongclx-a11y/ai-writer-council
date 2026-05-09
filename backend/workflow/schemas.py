from __future__ import annotations
from pydantic import BaseModel, Field


class Character(BaseModel):
    name: str
    role: str = ""
    description: str = ""
    voice: str = ""


class Style(BaseModel):
    tone: str = ""
    pace: str = ""
    pov: str = ""
    reference_authors: list[str] = Field(default_factory=list)


class Constraints(BaseModel):
    forbidden_themes: list[str] = Field(default_factory=list)
    forbidden_devices: list[str] = Field(default_factory=list)
    must_keep: list[str] = Field(default_factory=list)


class Setting(BaseModel):
    title: str
    genre: str = ""
    expected_length: int | None = None
    world_view: str = ""
    characters: list[Character] = Field(default_factory=list)
    style: Style = Field(default_factory=Style)
    constraints: Constraints = Field(default_factory=Constraints)


class RoundBrief(BaseModel):
    scene_brief: str
    scene_setting: str = ""
    involved_characters: list[str] = Field(default_factory=list)
    goal: str = ""
    must_include: list[str] = Field(default_factory=list)
    must_avoid: list[str] = Field(default_factory=list)
    target_length: int = 1500
    pace_for_this_round: str = ""
    emotional_arc: str = ""
    prev_summary: str = ""
    last_paragraph: str = ""
    session_id: str = ""
    round_number: int = 1


class RoundResult(BaseModel):
    scene_text: str
    round_log: list[dict] = Field(default_factory=list)
    major_decisions: list[dict] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
